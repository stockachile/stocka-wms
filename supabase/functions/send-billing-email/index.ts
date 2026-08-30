import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function formatCLP(val: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(val);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'No definida';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function addDays(dateStr: string | null, days: number): string {
  if (!dateStr) return 'No definida';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return 'No definida';
  }
}

async function getSignedUrlIfPrivate(url: string | null, supabaseClient: any): Promise<string> {
  if (!url) return '';
  if (url.includes('/payment_receipts/')) {
    try {
      const parts = url.split('/payment_receipts/');
      if (parts.length > 1) {
        const storagePath = decodeURIComponent(parts[1].split('?')[0]);
        const { data, error } = await supabaseClient.storage
          .from('payment_receipts')
          .createSignedUrl(storagePath, 2592000); // 30 dias
        if (!error && data && data.signedUrl) {
          return data.signedUrl;
        } else {
          console.error('Error generating signed URL in Edge Function:', error);
        }
      }
    } catch (e) {
      console.error('Error parsing payment_receipts URL in Edge Function:', e);
    }
  }
  return url;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const brevoApiKey = Deno.env.get('BREVO_API_KEY') ?? ''
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!brevoApiKey) {
      return new Response(JSON.stringify({ error: 'BREVO_API_KEY is not configured in Supabase Secrets' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace(/^Bearer\s/i, '').trim()
    const cleanServiceKey = supabaseServiceKey.trim()

    if (!cleanServiceKey) {
      console.error("Configuración errónea: SUPABASE_SERVICE_ROLE_KEY no está configurada en Supabase Secrets");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseClient = createClient(supabaseUrl, cleanServiceKey, {
      auth: { persistSession: false }
    })

    // Validar autorización
    let isAuthorized = false;
    let user = null;

    if (token === cleanServiceKey) {
      isAuthorized = true;
    } else {
      const { data: { user: verifiedUser }, error: authErr } = await supabaseClient.auth.getUser(token)
      if (!authErr && verifiedUser) {
        user = verifiedUser;
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
        if (profile && (profile.role === 'admin' || profile.role === 'all')) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized: Admins or triggers only'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const payload = await req.json()
    const { 
      recordId, 
      serviceType, 
      emails, 
      customMessage, 
      emailType = 'billing_summary', 
      commerceName: payloadCommerceName,
      comercio,
      onboardingDetails,
      isCorrection = false
    } = payload;

    // Cargar registro de facturación si se suministra, o buscar el más reciente si solo tenemos commerceName
    let record = null;
    const targetCommerce = payloadCommerceName || comercio;
    if (recordId) {
      const { data } = await supabaseClient
        .from('billing_records')
        .select('*, billing_periods(name)')
        .eq('id', recordId)
        .maybeSingle()
      record = data;
    } else if (targetCommerce) {
      const { data } = await supabaseClient
        .from('billing_records')
        .select('*, billing_periods(name)')
        .eq('comercio', targetCommerce)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      record = data;
    }

    // Sincronización a pedido de eventos de lectura (Aperturas y Clics) desde la API de Brevo
    if (emailType === 'sync_lead_email_events' || emailType === 'sync_brevo_events') {
      try {
        console.log('[send-billing-email] Sincronizando eventos de lectura y clics desde Brevo...');
        const brevoEventsRes = await fetch("https://api.brevo.com/v3/smtp/statistics/events?limit=100&sort=desc", {
          headers: {
            "accept": "application/json",
            "api-key": brevoApiKey
          }
        });

        if (!brevoEventsRes.ok) {
          const errText = await brevoEventsRes.text();
          throw new Error(`Error consultando eventos de Brevo: ${errText}`);
        }

        const eventsData = await brevoEventsRes.json();
        const eventsList = eventsData.events || [];
        const relevantEvents = eventsList.filter((e: any) => 
          ['opened', 'unique_opened', 'loadedByProxy', 'clicks', 'delivered'].includes(e.event)
        );

        let updatedCount = 0;

        await Promise.allSettled(relevantEvents.map(async (evt: any) => {
          const eventName = evt.event;
          const messageId = evt.messageId;
          const email = (evt.email || "").toLowerCase().trim();
          const eventDate = evt.date ? new Date(evt.date).toISOString() : new Date().toISOString();
          const clickedLink = evt.link || null;

          const isOpened = eventName === "opened" || eventName === "unique_opened" || eventName === "loadedByProxy";
          const isClicked = eventName === "clicks";
          const isDelivered = eventName === "delivered";

          let dbStatus = "enviado";
          if (isDelivered) dbStatus = "entregado";
          else if (isOpened) dbStatus = "abierto";
          else if (isClicked) dbStatus = "clickeado";

          const updatePayload: any = { status: dbStatus };
          if (isOpened) updatePayload.opened_at = eventDate;
          if (isClicked) {
            updatePayload.clicked_at = eventDate;
            if (clickedLink) updatePayload.notes = `Clic en enlace: ${clickedLink}`;
          }

          // Update lead_info_email_logs
          if (messageId) {
            await supabaseClient.from("lead_info_email_logs").update(updatePayload).eq("message_id", messageId);
          } else if (email) {
            await supabaseClient.from("lead_info_email_logs").update(updatePayload).ilike("recipient_email", email);
          }

          // Update e1_email_logs
          if (messageId) {
            await supabaseClient.from("e1_email_logs").update(updatePayload).eq("message_id", messageId);
          } else if (email) {
            await supabaseClient.from("e1_email_logs").update(updatePayload).ilike("recipient_email", email);
          }

          // Update profiles
          if (email) {
            const { data: matchedProfiles } = await supabaseClient.from("profiles").select("id, lead_emails_sent").ilike("email", email);
            if (matchedProfiles && matchedProfiles.length > 0) {
              for (const prof of matchedProfiles) {
                const history = Array.isArray(prof.lead_emails_sent) ? [...prof.lead_emails_sent] : [];
                let modified = false;
                history.forEach((h: any) => {
                  if (!h.status || h.status === 'enviado' || h.status === 'delivered' || isOpened || isClicked) {
                    h.status = dbStatus;
                    if (isOpened && !h.opened_at) h.opened_at = eventDate;
                    if (isClicked) {
                      h.clicked_at = eventDate;
                      if (clickedLink) h.link_clicked = clickedLink;
                    }
                    modified = true;
                  }
                });
                if (modified) {
                  await supabaseClient.from("profiles").update({ lead_emails_sent: history }).eq("id", prof.id);
                }
              }
            }
          }
          updatedCount++;
        }));

        return new Response(JSON.stringify({ 
          success: true, 
          message: `Sincronizados ${relevantEvents.length} eventos de Brevo con éxito.`,
          updatedCount: updatedCount,
          events: relevantEvents.slice(0, 30)
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (syncErr: any) {
        console.error('[send-billing-email] Error sincronizando eventos de Brevo:', syncErr);
        return new Response(JSON.stringify({ error: syncErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Cancelar envío si el tipo es automático y ya no está atrasado
    if (emailType === 'payment_overdue' && record) {
      const isFulfOverdue = record.pago_fulfillment === 'Atrasado';
      const isEnvOverdue = record.pago_enviame === 'Atrasado';
      const checkFulf = (resolvedServiceType === 'fulfillment' || resolvedServiceType === 'both') && isFulfOverdue;
      const checkEnv = (resolvedServiceType === 'enviame' || resolvedServiceType === 'both') && isEnvOverdue;
      
      if (!checkFulf && !checkEnv) {
        console.log(`[send-billing-email] El registro ${recordId} para ${record.comercio} ya no tiene deudas atrasadas para el servicio ${resolvedServiceType}. Cancelando envío.`);
        return new Response(JSON.stringify({ message: 'El cobro ya no está atrasado. Cancelando envío.' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const commerceName = record?.comercio || targetCommerce;

    if (!commerceName && emailType !== 'stock_inbound_created') {
      return new Response(JSON.stringify({ error: 'Falta parámetro recordId o commerceName' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const periodName = record?.billing_periods?.name || 'Periodo Actual';

    // Obtener los contactos de facturación activos para este comercio
    const { data: contacts } = await supabaseClient
      .from('billing_contacts')
      .select('email, nombre')
      .eq('comercio', commerceName || '')
      .eq('activo', true)

    const isSystemNotif = [
      'onboarding_received', 
      'onboarding_approved', 
      'onboarding_observed', 
      'onboarding_admin_notification', 
      'stock_inbound_created', 
      'stock_inbound_warehouse_assigned',
      'stock_inbound_received',
      'stock_inbound_completed',
      'shopify_pin_submitted', 
      'onboarding_contract_received', 
      'onboarding_catalog_ready', 
      'onboarding_enviame_instructions',
      'onboarding_e1_instructions',
      'onboarding_e1',
      'lead_info_fulfillment',
      'lead_info_presentation',
      'commercial_info'
    ].includes(emailType);

    const validEmails = (contacts || []).map((c: any) => c.email.toLowerCase().trim())
    let recipientEmails: string[] = []

    const singleEmail = payload.email || payload.recipientEmail || payload.destinatario;
    if (singleEmail) {
      const cleanedSingle = String(singleEmail).toLowerCase().trim();
      if (cleanedSingle.includes('@') && cleanedSingle.includes('.')) {
        recipientEmails.push(cleanedSingle);
      }
    }

    if (Array.isArray(emails) && emails.length > 0) {
      emails.forEach((email: string) => {
        const cleaned = email.toLowerCase().trim()
        if (validEmails.includes(cleaned) || (cleaned.includes('@') && cleaned.includes('.'))) {
          if (!recipientEmails.includes(cleaned)) {
            recipientEmails.push(cleaned)
          }
        }
      })
    } else if (recipientEmails.length === 0) {
      recipientEmails.push(...validEmails)
    }

    if (recipientEmails.length === 0 && !isSystemNotif) {
      return new Response(JSON.stringify({ error: `El comercio '${commerceName}' no tiene correos de facturación configurados ni se especificaron destinatarios.` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const resolvedServiceType = serviceType || 'both';
    const showFulfillment = (resolvedServiceType === 'fulfillment' || resolvedServiceType === 'both') && record;
    const showEnviame = (resolvedServiceType === 'enviame' || resolvedServiceType === 'both') && record;

    let totalMonto = 0;
    let servicesHtml = '';

    if (showFulfillment && record) {
      totalMonto += (record.total_fulfillment || 0);
      let docLink = record.fulfillment_pdf_url || record.fulfillment_link;
      if (docLink) {
        docLink = await getSignedUrlIfPrivate(docLink, supabaseClient);
      }
      const docBtn = docLink 
        ? `<a href="${docLink}" target="_blank" style="display: inline-block; background-color: #ffffff !important; color: #2563eb !important; border: 1px solid #2563eb; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; text-decoration: none;">Descargar Desglose Fulfillment</a>` 
        : '<span style="color:#ef4444; font-size:12px; font-weight:600;">Desglose PDF no adjuntado aún</span>';

      servicesHtml += `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
          <div style="font-size: 15px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">Servicio Fulfillment (Almacenaje y Operación)</div>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color: #475569;"><strong>Monto Facturado:</strong></td>
              <td style="padding: 6px 0; font-size: 14px; color: #1e293b; text-align: right; font-weight: 700;">${formatCLP(record.total_fulfillment || 0)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color: #475569;"><strong>Fecha Límite de Pago:</strong></td>
              <td style="padding: 6px 0; font-size: 14px; color: #475569; text-align: right;">${formatDate(record.fecha_limite)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color: #475569;"><strong>Estado de Pago:</strong></td>
              <td style="padding: 6px 0; font-size: 14px; color: #475569; text-align: right;"><span style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; text-transform: uppercase; ${record.pago_fulfillment === 'Recibido' ? 'background-color: #dcfce7; color: #166534;' : 'background-color: #fef3c7; color: #92400e;'}">${record.pago_fulfillment || 'Pendiente'}</span></td>
            </tr>
          </table>
          <div style="margin-top: 15px; text-align: center;">
            ${docBtn}
          </div>
        </div>
      `;
    }

    if (showEnviame && record) {
      totalMonto += (record.enviame || 0);
      
      let enviameDocsHtml = '';
      if (record.enviame_pdfs && Array.isArray(record.enviame_pdfs) && record.enviame_pdfs.length > 0) {
        const portalUrl = "https://wms.stocka.cl";
        enviameDocsHtml = `
          <div style="font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 12px; text-align: center;">
            El desglose detallado de envíos y el reporte interactivo están disponibles para su revisión y descarga en el panel de facturación.
          </div>
          <a href="${portalUrl}" target="_blank" style="display: inline-block; background-color: #5B00E4 !important; color: #ffffff !important; padding: 10px 22px; font-size: 13px; font-weight: 700; border-radius: 6px; text-decoration: none; box-shadow: 0 2px 5px rgba(91, 0, 228, 0.2);">
            Ingresar al WMS
          </a>
        `;
      } else {
        enviameDocsHtml = '<span style="color:#ef4444; font-size:12px; font-weight:600;">Desglose no adjuntado aún</span>';
      }

      servicesHtml += `
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 15px;">
          <div style="font-size: 15px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 15px;">Servicio Envíame (Courier y Despacho)</div>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color: #475569;"><strong>Monto Facturado:</strong></td>
              <td style="padding: 6px 0; font-size: 14px; color: #1e293b; text-align: right; font-weight: 700;">${formatCLP(record.enviame || 0)}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color: #475569;"><strong>Fecha Límite de Pago:</strong></td>
              <td style="padding: 6px 0; font-size: 14px; color: #475569; text-align: right;">${formatDate(record.fecha_limite_enviame)} <span style="font-size: 11px; color: #ea580c; font-weight: bold; display: block;">(Plazo de 3 días fijado por Envíame)</span></td>
            </tr>
            <tr>
              <td style="padding: 6px 0; font-size: 14px; color: #475569;"><strong>Estado de Pago:</strong></td>
              <td style="padding: 6px 0; font-size: 14px; color: #475569; text-align: right;"><span style="display: inline-block; padding: 3px 8px; font-size: 11px; font-weight: 600; border-radius: 4px; text-transform: uppercase; ${record.pago_enviame === 'Recibido' ? 'background-color: #dcfce7; color: #166534;' : 'background-color: #fef3c7; color: #92400e;'}">${record.pago_enviame || 'Pendiente'}</span></td>
            </tr>
          </table>
          <div style="margin-top: 15px; text-align: center;">
            ${enviameDocsHtml}
          </div>
        </div>
      `;
    }

    let emailSubject = '';
    let headerGradient = '';
    let emailTitle = '';
    let emailBodyHtml = '';
    let htmlBody = '';
    let mainNoticeHtml = '';

    const appealDeadlineNote = (showEnviame && record)
      ? `<div style="margin-top: 15px; padding: 12px; border: 1px solid #bfdbfe; background-color: #eff6ff; border-radius: 6px; font-size: 13px; color: #1e3a8a; line-height: 1.5;">
          <strong>Plazo de Apelaciones:</strong><br>
          Recuerda que para el servicio Envíame cuentas con un plazo de 5 días para realizar cualquier apelación. El plazo máximo vence el <strong>${addDays(record.fecha_limite_enviame, 2)}</strong>.
         </div>`
      : '';

    const paymentDetailsHtml = `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 20px 0; font-family: sans-serif;">
        <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;">
          Datos para Transferencia Bancaria
        </div>
        <table style="width: 100%; font-size: 12px; border-collapse: collapse; line-height: 1.5;">
          <tr>
            <td style="color: #64748b; padding: 3px 0; width: 120px; font-weight: 500;">Razón Social:</td>
            <td style="color: #1e293b; padding: 3px 0; font-weight: 600;">STOCKA SPA</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 3px 0; font-weight: 500;">RUT:</td>
            <td style="color: #1e293b; padding: 3px 0; font-weight: 600;">77.524.557-3</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 3px 0; font-weight: 500;">Banco:</td>
            <td style="color: #1e293b; padding: 3px 0; font-weight: 600;">SCOTIABANK (SUD AMERICANO)</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 3px 0; font-weight: 500;">Tipo de Cuenta:</td>
            <td style="color: #1e293b; padding: 3px 0; font-weight: 600;">CTA CORRIENTE</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 3px 0; font-weight: 500;">N° de Cuenta:</td>
            <td style="color: #1e293b; padding: 3px 0; font-weight: 600; font-family: monospace; font-size: 12.5px;">992369965</td>
          </tr>
          <tr>
            <td style="color: #64748b; padding: 3px 0; font-weight: 500;">Email de Envío:</td>
            <td style="color: #2563eb; padding: 3px 0; font-weight: 600;"><a href="mailto:finanzas@stocka.cl" style="color:#2563eb; text-decoration:none;">finanzas@stocka.cl</a></td>
          </tr>
        </table>
      </div>
    `;

    if (emailType === 'payment_overdue') {
      let serviceLabel = '';
      if (resolvedServiceType === 'fulfillment') {
        serviceLabel = 'Fulfillment';
      } else if (resolvedServiceType === 'enviame') {
        serviceLabel = 'Envíame';
      } else {
        serviceLabel = 'Fulfillment y Envíame';
      }
      emailSubject = `[URGENTE] Plazo de pago vencido (${serviceLabel}) - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #ea580c, #c2410c)';
      emailTitle = 'Plazo de Pago Vencido';
      
      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Te informamos que el plazo límite de pago para tus servicios del periodo <strong>${periodName}</strong> ha vencido y aún no registramos el pago correspondiente en nuestro sistema.
        </div>
        
        ${servicesHtml}
        
        <div style="margin-top: 25px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 700; color: #1e3a8a;">Total Pendiente:</span>
          <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
        </div>

        ${appealDeadlineNote}

        ${paymentDetailsHtml}

        <div style="margin-top: 30px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; background-color: #f8fafc;">
          <strong style="color: #1e293b; font-size: 15px; display: block; margin-bottom: 12px;">¿Cómo registrar tu pago en el WMS?</strong>
          <ol style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.6;">
            <li style="margin-bottom: 6px;">Ingresa a la plataforma del WMS Stocka: <a href="https://stocka-wms.netlify.app/dashboard.html" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: none;">stocka-wms.netlify.app</a></li>
            <li style="margin-bottom: 6px;">Navega al menú lateral y entra al módulo de <strong>Facturación</strong>.</li>
            <li style="margin-bottom: 6px;">Ubica el periodo pendiente en la tabla y haz clic en el botón <strong>Adjuntar Comprobante</strong> (icono de clip/adjunto 📎).</li>
            <li style="margin-bottom: 6px;">Sube el comprobante de pago en formato PDF o imagen y presiona <strong>Enviar Reporte</strong>.</li>
          </ol>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #fff1f2; border: 1px solid #ffe4e6; color: #9f1239; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Nota de Servicio:</strong><br>
          Recordamos que mantener tus facturas al día es fundamental para garantizar que la operación y despacho de tus pedidos continúen sin interrupciones.
        </div>
      `;
    } 
    else if (emailType === 'payment_overdue_manual') {
      let serviceLabel = '';
      if (resolvedServiceType === 'fulfillment') {
        serviceLabel = 'Fulfillment';
      } else if (resolvedServiceType === 'enviame') {
        serviceLabel = 'Envíame';
      } else {
        serviceLabel = 'Fulfillment y Envíame';
      }
      emailSubject = `[AVISO] Plazo de pago vencido (${serviceLabel}) - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #f97316, #ea580c)';
      emailTitle = 'Plazo de Pago Vencido';

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Nos comunicamos para informarte que se ha <strong>excedido el plazo límite de pago</strong> para tus servicios pendientes del periodo <strong>${periodName}</strong>.
        </div>

        <div style="background-color: #fff7ed; border: 1px solid #ffedd5; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #c2410c; line-height: 1.5; font-weight: 600;">
          ⚠️ Te invitamos a regularizar tu situación a la brevedad para evitar la interrupción o pausa temporal de tus operaciones y servicios de despacho.
        </div>

        ${servicesHtml}

        <div style="margin-top: 25px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 700; color: #1e3a8a;">Total Pendiente:</span>
          <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
        </div>

        ${appealDeadlineNote}

        ${paymentDetailsHtml}

        <div style="margin-top: 30px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; background-color: #f8fafc;">
          <strong style="color: #1e293b; font-size: 15px; display: block; margin-bottom: 12px;">¿Cómo puedes informar tu pago?</strong>
          <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; color: #475569; line-height: 1.6;">
            <li style="margin-bottom: 6px;"><strong>Opción 1 (Recomendada):</strong> Sube tu comprobante directamente en el WMS Stocka ingresando a la sección <strong>Facturación</strong> y haciendo clic en el botón de adjunto (clip 📎) en el periodo correspondiente.</li>
            <li style="margin-bottom: 6px;"><strong>Opción 2:</strong> Responde directamente a este correo adjuntando el comprobante de la transferencia realizada.</li>
          </ul>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #fff1f2; border: 1px solid #ffe4e6; color: #9f1239; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Nota sobre la continuidad de tu servicio:</strong><br>
          Recordamos que mantener tus facturas al día es fundamental. En caso de no registrarse el pago oportuno, el servicio de preparación y despacho de tu comercio podría ser pausado temporalmente en los próximos días.
        </div>
      `;
    }
    else if (emailType === 'suspension_warning') {
      emailSubject = `[ALERTA] Pausa de servicio por no pago - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #dc2626, #991b1b)';
      emailTitle = 'Pausa Temporal de Servicio';

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Nos comunicamos para informarte que debido a un retraso crítico en el pago de los servicios pendientes de <strong>${periodName}</strong>, <strong>tu servicio de WMS y despachos quedará pausado desde este momento hasta que puedas regularizar</strong>.
        </div>

        <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #991b1b; line-height: 1.5; font-weight: 600; text-align: center; text-transform: uppercase;">
          ⚠️ SERVICIO PAUSADO DESDE ESTE MOMENTO
        </div>
        
        ${servicesHtml}
        
        <div style="margin-top: 25px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 700; color: #1e3a8a;">Total Adeudado:</span>
          <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
        </div>

        ${appealDeadlineNote}

        ${paymentDetailsHtml}
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #fffbeb; border: 1px solid #fef3c7; color: #78350f; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Contacto para Asistencia y Restablecimiento:</strong><br>
          Para asistirte a la brevedad y proceder a restablecer tus servicios, por favor ponte en contacto de inmediato con nuestro equipo enviando tu comprobante de transferencia a <a href="mailto:finanzas@stocka.cl" style="color:#b45309; font-weight:600;">finanzas@stocka.cl</a>.
        </div>
      `;
    } 
    else if (emailType === 'service_paused') {
      emailSubject = `[CORTE DE SERVICIO] Cuenta suspendida por no pago - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #7f1d1d, #450a0a)';
      emailTitle = 'Servicio Temporalmente Suspendido';

      let pendingAmountText = '';
      if (record) {
        pendingAmountText = `
          <div style="margin-top: 25px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 15px; font-weight: 700; color: #1e3a8a;">Monto para Reactivación:</span>
            <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
          </div>
        `;
      }

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Te informamos que debido al atraso continuo de pago de tus servicios pendientes, <strong>el servicio de tu comercio ha sido pausado temporalmente</strong>.
        </div>

        <div style="background-color: #7f1d1d; border-radius: 8px; padding: 20px; margin-bottom: 20px; font-size: 14.5px; color: #ffffff; line-height: 1.5; font-weight: 600; text-align: center;">
          SERVICIO PAUSADO TEMPORALMENTE
        </div>

        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          A partir de este momento, se ha restringido el acceso al WMS para:
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>Ingreso de stock y carga de plantillas.</li>
            <li>Creación de pedidos y despachos de Courier.</li>
            <li>Preparación y empaque de productos en bodega (Fulfillment).</li>
          </ul>
        </div>
        
        ${pendingAmountText}

        ${paymentDetailsHtml}
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #fef2f2; border: 1px solid #fee2e2; color: #991b1b; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Cómo Reactivar tu Servicio:</strong><br>
          Para restablecer las operaciones normales de tu comercio de forma inmediata, debes regularizar el pago pendiente y **subir el comprobante al sistema WMS**, o bien comunicarte directamente con nosotros a <a href="mailto:finanzas@stocka.cl" style="color:#991b1b; font-weight:600; text-decoration:underline;">finanzas@stocka.cl</a>.
        </div>
      `;
    } 
    else if (emailType === 'invoice_uploaded') {
      emailSubject = `[Factura Disponible] Factura de servicios cargada - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #10b981, #059669)'; // Emerald Green
      emailTitle = 'Factura de Servicios Disponible';

      let invoiceButtonsHtml = '';
      if (record) {
        if (record.factura_fulfillment_pdf_url) {
          const signedUrl = await getSignedUrlIfPrivate(record.factura_fulfillment_pdf_url, supabaseClient);
          invoiceButtonsHtml += `<a href="${signedUrl}" target="_blank" style="display: inline-block; background-color: #2563eb !important; color: #ffffff !important; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; margin: 5px;">Descargar Factura Fulfillment</a>`;
        }
        if (record.factura_enviame_pdf_url) {
          const signedUrl = await getSignedUrlIfPrivate(record.factura_enviame_pdf_url, supabaseClient);
          invoiceButtonsHtml += `<a href="${signedUrl}" target="_blank" style="display: inline-block; background-color: #2563eb !important; color: #ffffff !important; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; margin: 5px;">Descargar Factura Envíame</a>`;
        }
      }

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Le informamos que se ha cargado en la plataforma del WMS Stocka la factura correspondiente a sus servicios del periodo <strong>${periodName}</strong>.
        </div>

        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-bottom: 20px; font-size: 14.5px; color: #166534; line-height: 1.5; font-weight: 600; text-align: center;">
          FACTURA DISPONIBLE EN EL PORTAL
        </div>

        ${invoiceButtonsHtml ? `
          <div style="margin: 20px 0; text-align: center;">
            ${invoiceButtonsHtml}
          </div>
        ` : ''}

        ${servicesHtml}
        
        <div style="margin-top: 25px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 700; color: #1e3a8a;">Total Período:</span>
          <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
        </div>

        ${paymentDetailsHtml}
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Acceso a Facturas Históricas:</strong><br>
          Le recordamos que puede revisar e informar el pago de esta y otras facturas pasadas directamente desde el portal de facturación en su cuenta del WMS.
        </div>
      `;
    }
    else if (emailType === 'payment_received') {
      if (resolvedServiceType === 'fulfillment') {
        emailSubject = `[Confirmación] Pago recibido por servicios Fulfillment - ${commerceName}`;
      } else if (resolvedServiceType === 'enviame') {
        emailSubject = `[Confirmación] Pago recibido por despachos Enviame - ${commerceName}`;
      } else {
        emailSubject = `[Confirmación] Pago recibido por servicios - ${commerceName}`;
      }
      headerGradient = 'linear-gradient(135deg, #0d9488, #0f766e)'; // Turquesa / Teal
      emailTitle = 'Confirmación de Pago';

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Confirmamos que hemos recibido con éxito tu pago correspondiente a los servicios de <strong>${periodName}</strong>.
        </div>

        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-bottom: 20px; font-size: 14.5px; color: #166534; line-height: 1.5; font-weight: 600; text-align: center; text-transform: uppercase;">
          PAGO CONFIRMADO Y REGISTRADO
        </div>

        ${servicesHtml}
        
        <div style="margin-top: 25px; padding: 15px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 700; color: #166534;">Monto Registrado:</span>
          <span style="font-size: 20px; font-weight: 800; color: #166534;">${formatCLP(totalMonto)}</span>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Comprobante de Pago WMS:</strong><br>
          Tu pago ya se encuentra acreditado y registrado en el módulo de Facturación del sistema WMS Stocka. Puedes ingresar en cualquier momento para descargar tu comprobante o revisar el historial de transacciones.
        </div>
      `;
    }
    else if (emailType === 'service_restored') {
      emailSubject = `[SERVICIO RESTABLECIDO] Cuenta reactivada - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #16a34a, #15803d)'; // Verde
      emailTitle = 'Servicio Restablecido';

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Nos alegra informarte que tu cuenta ha sido regularizada y el servicio de tu comercio ha sido **reactivado y restablecido con éxito**.
        </div>

        <div style="background-color: #dcfce7; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-bottom: 20px; font-size: 14.5px; color: #15803d; line-height: 1.5; font-weight: 600; text-align: center;">
          SERVICIO RESTABLECIDO Y OPERATIVO
        </div>

        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          A partir de este momento, se han habilitado nuevamente todas las funciones en el sistema WMS:
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>Ingreso de stock y carga de plantillas.</li>
            <li>Creación de pedidos y despachos.</li>
            <li>Preparación y despacho de Courier (Fulfillment y Envíame).</li>
          </ul>
          Agradecemos tu compromiso y pagos oportunos, los cuales nos ayudan a mantener una operación fluida y sin interrupciones.
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Continuidad del Servicio:</strong><br>
          Para cualquier consulta u observación adicional, recuerda que puedes de forma directa comunicarte con nosotros escribiendo a <a href="mailto:finanzas@stocka.cl" style="color:#1e3a8a; font-weight:600; text-decoration:underline;">finanzas@stocka.cl</a>.
        </div>
      `;
    }
    else if (emailType === 'onboarding_received') {
      emailSubject = `Registro de cuenta comercial recibido - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #4f46e5, #3b82f6)';
      emailTitle = 'Registro de Cuenta Recibido';
      
      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          ¡Gracias por iniciar tu proceso de alta en Stocka! Tus datos comerciales han sido registrados con éxito.
        </div>
        
        <div style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #b45309; line-height: 1.5;">
          <strong>Siguiente Paso Obligatorio:</strong> Firma de Contrato WMS<br>
          Para finalizar tu alta comercial, debes confirmar tu dirección de correo electrónico e iniciar sesión en el portal WMS. Al ingresar, se te guiará para subir tu contrato firmado.
        </div>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          Si ya has confirmado tu correo, puedes iniciar sesión utilizando el botón de abajo:
        </div>

        <div style="text-align: center; margin-top: 25px; margin-bottom: 15px;">
          <a href="https://stocka-wms.netlify.app" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff; text-decoration: none; padding: 12px 30px; font-size: 14px; font-weight: 600; border-radius: 6px; box-shadow: 0 4px 10px rgba(94, 23, 235, 0.25);">
            Ingresar al Portal WMS
          </a>
        </div>
      `;
    }
    else if (emailType === 'onboarding_contract_received') {
      emailSubject = `Hemos recibido tu contrato firmado - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #4f46e5, #3b82f6)';
      emailTitle = 'Contrato Firmado Recibido';
      
      const details = onboardingDetails || {};
      const annexes = details.acceptedAnnexes || [];
      let annexesHtml = '';
      if (Array.isArray(annexes) && annexes.length > 0) {
        annexesHtml = `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px; font-weight: 600; color: #475569; vertical-align: top;">Anexos Aceptados:</td>
            <td style="padding: 10px; color: #1e293b;">
              <ul style="margin: 0; padding-left: 20px; line-height: 1.5; font-size: 13px;">
                ${annexes.map((annex: any) => {
                  const formattedDate = annex.document_date ? annex.document_date.split('-').reverse().join('/') : 'S/F';
                  return `<li><strong>${annex.name}</strong> (Fecha: ${formattedDate}) - <a href="${annex.file_url}" target="_blank" style="color: #2563eb; text-decoration: underline;">Descargar</a></li>`;
                }).join('')}
              </ul>
            </td>
          </tr>
        `;
      }

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          ¡Gracias por completar tu proceso de onboarding! Hemos recibido con éxito tu contrato firmado.
        </div>
        
        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #1e40af; line-height: 1.5;">
          <strong>Estado:</strong> En Revisión Comercial<br>
          Nuestro equipo revisará los documentos y configurará los parámetros operativos de tu comercio. Te notificaremos por correo electrónico en un plazo estimado de 24 a 48 horas hábiles.
        </div>

        <div style="font-size: 14px; color: #1e293b; margin-bottom: 10px; font-weight: 600;">
          Resumen del acuerdo firmado (ambas partes reciben una copia idéntica del acuerdo):
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13.5px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569; width: 180px;">Contrato Firmado:</td>
              <td style="padding: 10px; color: #1e293b;">
                ${details.contratoUrl ? `<a href="${details.contratoUrl}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">Descargar PDF Contrato</a>` : 'No adjuntado'}
              </td>
            </tr>
            ${annexesHtml}
          </tbody>
        </table>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          Durante este periodo, si necesitas realizar alguna modificación o tienes dudas, puedes escribirnos a <a href="mailto:contacto@stocka.cl" style="color:#5e17eb; font-weight:600;">contacto@stocka.cl</a>.
        </div>
      `;
    }
    else if (emailType === 'onboarding_approved') {
      emailSubject = `¡Tu cuenta de Fulfillment 360 está activa! - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #10b981, #059669)';
      emailTitle = 'Alta de Comercio Aprobada';
      
      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          ¡Nos complace informarte que <strong>tu solicitud de alta ha sido aprobada con éxito</strong>!
        </div>
        
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #166534; line-height: 1.5; font-weight: 600; text-align: center;">
          CUENTA ACTIVA Y OPERATIVA
        </div>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          Tu comercio ha sido configurado y activado en el WMS de Stocka. A partir de ahora puedes acceder a tu cuenta utilizando tu correo electrónico y la contraseña que definiste al registrarte.
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          💡 <strong>¡Sigue tu Guía de Inicio interactiva!</strong><br>
          Al iniciar sesión por primera vez, verás la <strong>Guía de Inicio</strong> interactiva directamente en la pantalla principal de tu dashboard. Esta guía te indicará tu progreso en tiempo real a través de los 5 pasos obligatorios para habilitar tus operaciones.
        </div>
        
        <div style="border-top: 1px solid #e2e8f0; padding-top: 20px; margin-bottom: 25px;">
          <h3 style="font-size: 14.5px; color: #0f172a; margin-top: 0; margin-bottom: 15px; font-weight: 700;">
            📋 Los 5 pasos de tu Guía de Inicio:
          </h3>
          
          <!-- Paso 1 -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 12px; font-size: 13px; color: #475569; line-height: 1.6;">
            <strong style="color: #0f172a; display: block; margin-bottom: 6px; font-size: 13.5px;">
              <span style="color: #3b82f6; font-weight: 800;">1.</span> Conectar Integraciones
            </strong>
            Vincula tus canales de venta (Shopify, WooCommerce, Mercado Libre) desde el módulo de <strong>Integraciones</strong> para recibir tus pedidos de forma automática.
          </div>
 
          <!-- Paso 2 -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 12px; font-size: 13px; color: #475569; line-height: 1.6;">
            <strong style="color: #0f172a; display: block; margin-bottom: 6px; font-size: 13.5px;">
              <span style="color: #f59e0b; font-weight: 800;">2.</span> Carga de Catálogo Inicial
            </strong>
            Una vez conectes tus integraciones, nuestro equipo de operaciones configurará tu catálogo base. ¡Este paso lo completamos nosotros y te notificaremos cuando esté listo!
          </div>
 
          <!-- Paso 3 -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 12px; font-size: 13px; color: #475569; line-height: 1.6;">
            <strong style="color: #0f172a; display: block; margin-bottom: 6px; font-size: 13.5px;">
              <span style="color: #8b5cf6; font-weight: 800;">3.</span> Configuración de Envíos Courier (Enviame)
            </strong>
            Integraremos tu cuenta con Enviame para automatizar el despacho Courier de tus pedidos. Nuestro equipo ingresará el ID en el sistema y se marcará como listo de manera automática.
          </div>
 
          <!-- Paso 4 -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 12px; font-size: 13px; color: #475569; line-height: 1.6;">
            <strong style="color: #0f172a; display: block; margin-bottom: 6px; font-size: 13.5px;">
              <span style="color: #14b8a6; font-weight: 800;">4.</span> Guía de SKU y Embalaje
            </strong>
            Lee y descarga la guía de etiquetado desde la tarjeta correspondiente. Es vital que cada producto cuente con su código de barras (EAN/SKU) legible antes de enviarlo.
          </div>
 
          <!-- Paso 5 -->
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 12px; font-size: 13px; color: #475569; line-height: 1.6;">
            <strong style="color: #0f172a; display: block; margin-bottom: 6px; font-size: 13.5px;">
              <span style="color: #10b981; font-weight: 800;">5.</span> Declaración de tu Primer Ingreso
            </strong>
            Declara la mercadería que enviarás a nuestra bodega mediante una Declaración de Ingreso en el portal (se desbloquea al completarse el Paso 2).
          </div>
        </div>

        <div style="text-align: center; margin-top: 25px; margin-bottom: 15px;">
          <a href="https://stocka-wms.netlify.app" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff; text-decoration: none; padding: 12px 30px; font-size: 14px; font-weight: 600; border-radius: 6px; box-shadow: 0 4px 10px rgba(94, 23, 235, 0.25);">
            Ingresar al Portal WMS
          </a>
        </div>
      `;
    }
    else if (emailType === 'onboarding_catalog_ready') {
      emailSubject = `¡Tu catálogo ha sido configurado! - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #4f46e5, #3b82f6)';
      emailTitle = 'Catálogo Configurado';

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          ¡Nos complace informarte que <strong>el equipo de Stocka ha finalizado la configuración inicial de tu catálogo de productos</strong>!
        </div>
        
        <div style="background-color: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #0369a1; line-weight: 1.5; font-weight: 600; text-align: center;">
          CATÁLOGO CONFIGURADO Y HABILITADO
        </div>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 25px;">
          Tu catálogo ha sido cargado con éxito en el sistema. A partir de este momento puedes proceder a realizar los siguientes pasos de tu flujo de inicio en el portal:<br><br>
          1. **Declarar tu primer ingreso de stock (D.I.)** indicando qué mercancía vas a despachar a nuestra bodega.<br>
          2. **Revisar la Guía de SKU y pautas de embalaje** para asegurar que el inventario sea recibido sin problemas ni demoras.
        </div>

        <div style="text-align: center; margin-top: 25px; margin-bottom: 15px;">
          <a href="https://stocka-wms.netlify.app" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff; text-decoration: none; padding: 12px 30px; font-size: 14px; font-weight: 600; border-radius: 6px; box-shadow: 0 4px 10px rgba(94, 23, 235, 0.25);">
            Ingresar al Portal WMS
          </a>
        </div>
      `;
    }
    else if (emailType === 'onboarding_enviame_instructions') {
      const envIdVal = payload.enviameId || payload.enviame_id || 'ID_NO_CONFIGURADO';
      emailSubject = `Instrucciones de Integración y Configuración de Envíos - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #5e17eb, #7c3aed)';
      emailTitle = 'Integración de Envíos';

      // Consultar adjuntos para agregar enlaces directos en el cuerpo del correo
      let resourcesHtml = '';
      try {
        const { data: e3Docs } = await supabaseClient
          .from('service_docs')
          .select('name, file_url')
          .in('folder', ['E3', 'E3_General', 'E3_Shopify']);
        
        if (e3Docs && e3Docs.length > 0) {
          resourcesHtml = `
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 18px; margin-bottom: 20px; font-size: 13.5px; color: #166534; line-height: 1.6;">
              <strong style="color: #14532d; display: block; margin-bottom: 8px; font-size: 14.5px;">
                📂 Documentos Adjuntos y Enlaces de Descarga Directa:
              </strong>
              Haga clic en los siguientes enlaces para abrir o descargar el material adjunto:
              <ul style="margin: 8px 0; padding-left: 20px;">
          `;
          e3Docs.forEach((doc: any) => {
            resourcesHtml += `
              <li style="margin-bottom: 6px;">
                <a href="${doc.file_url}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">
                  ${doc.name} (Descargar PDF)
                </a>
              </li>
            `;
          });
          resourcesHtml += `
              </ul>
            </div>
          `;
        }
      } catch (err) {
        console.error('[send-billing-email] Error cargando enlaces E3 para cuerpo de correo:', err);
      }

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo de <strong>${commerceName}</strong>,<br><br>
          Junto con saludarte, te comentamos que ya contamos con el acceso al canal de Shopify. En esta etapa revisaremos la integración para los sistemas de envío de última milla. A continuación, te detallamos las opciones disponibles y los pasos obligatorios para su conexión:
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 16px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; display: block; margin-bottom: 8px; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
            A.- DESPACHOS EN SANTIAGO (RM) - SAME DAY / 24 HRS
          </strong>
          En la Región Metropolitana ofrecemos entregas <strong>Same Day</strong> para ventas generadas hasta las <strong>12:00 hrs</strong>. 
          Te adjuntamos en este correo la presentación de este servicio con el detalle de costos, coberturas y operaciones.
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 16px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; display: block; margin-bottom: 8px; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
            B.- DESPACHOS A REGIONES - INTEGRACIÓN ENVIAME
          </strong>
          Para regiones integramos tu tienda dentro de nuestra cuenta corporativa de <a href="https://enviame.io/" target="_blank" style="color: #2563eb; text-decoration: underline; font-weight: 600;">Enviame</a> de manera personalizada.
          <br><br>
          <strong>Pasos para la conexión vía Webhook (REQUERIDO):</strong>
          <ol style="margin: 8px 0; padding-left: 20px; line-height: 1.6;">
            <li>Abre el <strong>manual de integración adjunto</strong> en este correo y dirígete a la <strong>página 3</strong>.</li>
            <li>Sigue las indicaciones de las <strong>páginas 3, 4 y 5</strong>. En el campo <em>Evento</em> selecciona <strong>"Pedido preparado"</strong>.</li>
            <li>En la página 4, reemplaza el valor de ejemplo '1111' por tu ID de Enviame definitivo: <strong style="background-color: #ffe4e6; color: #b91c1c; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 14px;">${envIdVal}</strong></li>
            <li>Una vez creados, copia los códigos generados y compártelos con nosotros <strong>como texto</strong> (no captura de pantalla) respondiendo a este correo para finalizar la activación.</li>
          </ol>
          <span style="color: #b91c1c; font-weight: 600; display: block; margin-top: 8px; font-size: 12.5px;">
            ⚠️ IMPORTANTE: No modifiques o elimines este webhook una vez creado; de lo contrario, la emisión de etiquetas fallará.
          </span>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin-bottom: 20px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; display: block; margin-bottom: 8px; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px;">
            C.- INTEGRACIÓN DE TARIFAS EN TIEMPO REAL EN EL CHECKOUT (OPCIONAL)
          </strong>
          Dado que las tarifas logísticas dependen de la comuna y peso del paquete, es vital asegurar que las comunas estén bien estandarizadas en Shopify. Te recomendamos estas opciones:
          <br><br>
          <ul style="margin: 8px 0; padding-left: 20px; line-height: 1.6;">
            <li style="margin-bottom: 8px;">
              <strong>1. Aplicación Selecty (Opción Recomendada):</strong>
              Permite mostrar tarifas optimizadas en el checkout en 1 día de implementación. Costo aprox. 12 USD/mes. Requiere cargar una planilla de tarifas que te compartiremos. 
              Puedes instalarla desde: <a href="https://apps.shopify.com/sector-de-comuna-cl-gratis?locale=es" target="_blank" style="color: #2563eb; text-decoration: underline;">App Selecty</a>.
            </li>
            <li style="margin-bottom: 8px;">
              <strong>2. Aplicaciones CCS de Terceros:</strong>
              Como el <a href="https://haciendola.com/pages/tarificador" target="_blank" style="color: #2563eb; text-decoration: underline;">Tarificador de Haciendola</a> o la app de <a href="https://apps.shopify.com/tarificador-chile?locale=es" target="_blank" style="color: #2563eb; text-decoration: underline;">Lobo Creaciones</a>. Requieren tener activa la función Carrier-Calculated Shipping (CCS) en Shopify. Costo aprox. 40 USD/mes.
            </li>
            <li style="margin-bottom: 8px;">
              <strong>3. Checkout Gratis de Enviame:</strong>
              Se solicita al equipo de soporte de Enviame (plazo de implementación 4-7 días). Requiere que nos otorgues permisos de "aplicaciones" en tu tienda Shopify.
            </li>
            <li style="margin-bottom: 8px;">
              <strong>4. Configuración Nativa Simplificada:</strong>
              Usar las zonas y tarifas de envío manuales/nativas de Shopify a tu criterio.
            </li>
          </ul>
        </div>

        ${resourcesHtml}

        <div style="background-color: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 15px; margin-bottom: 25px; font-size: 13.5px; color: #5b21b6; line-height: 1.5; font-weight: 500;">
          📂 <strong>Tarifarios y Recursos Útiles:</strong><br>
          Puedes revisar y descargar la carpeta con las tarifas de Enviame y material de apoyo en el siguiente enlace:<br>
          <a href="https://drive.google.com/drive/folders/1670M-vkABh7Qiyce4pH1YvL_67KZTfMH" target="_blank" style="color: #2563eb; font-weight: bold; text-decoration: underline; display: inline-block; margin-top: 6px;">Carpeta de Tarifarios y Recursos Stocka</a>
        </div>
      `;
    }
    else if (emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info') {
      const contactGreeting = payload.contactName || payload.nombreContacto || payload.nombre_contacto || payload.nombre || payload.full_name || '';
      const displayGreeting = contactGreeting 
        ? `¡Hola, ${contactGreeting}! 👋` 
        : `¡Hola! 👋`;
      
      const displayCommerce = commerceName && commerceName !== 'Cliente WMS' && commerceName !== 'Comercio' ? ` - ${commerceName}` : '';
      emailSubject = payload.subject || `Información y Propuesta Fulfillment 360 - Stocka${displayCommerce}`;
      headerGradient = '#0f172a';
      emailTitle = 'Propuesta y Servicios Fulfillment 360';

      const customIntroMessage = payload.customMessage || payload.notes || '';
      const fulfillmentDocUrl = payload.fulfillmentUrl || 'https://ejtjfaucnxbikrwjwwdu.supabase.co/storage/v1/object/public/service_docs/presentations/presentacion_fulfillment_360_1787715943297.pdf';
      const despachosDocUrl = payload.despachosUrl || 'https://ejtjfaucnxbikrwjwwdu.supabase.co/storage/v1/object/public/service_docs/presentations/presentacion_despachos_rm_1787715973435.pdf';
      const courierFolderUrl = payload.courierFolderUrl || 'https://drive.google.com/drive/folders/1670M-vkABh7Qiyce4pH1YvL_67KZTfMH';
      const cotizadorUrl = payload.cotizadorUrl || 'https://wms.stocka.cl/cotizaciones.html';
      const meetingUrl = payload.meetingUrl || 'https://meetings.hubspot.com/stocka?uuid=929cb56a-bc62-4d02-95c4-6005a47768a5';

      htmlBody = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${emailSubject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; }
    .email-container { max-width: 650px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .email-header { background: #0f172a; padding: 30px 25px; text-align: center; color: #ffffff; }
    .email-logo { height: 42px; margin-bottom: 12px; display: inline-block; }
    .email-header-title { font-size: 20px; font-weight: 700; margin: 0; color: #ffffff; letter-spacing: 0.5px; }
    .email-header-subtitle { font-size: 13px; color: #94a3b8; margin-top: 5px; }
    .email-body { padding: 30px 25px; }
    .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
    .intro-text { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 20px; }
    .kpi-cards-grid { display: table; width: 100%; margin-bottom: 20px; }
    .kpi-card { display: table-cell; width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; vertical-align: top; }
    .btn-meeting { display: block; background: #5e17eb; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(94,23,235,0.3); }
    .btn-wa { display: block; background: #25d366; color: #ffffff !important; text-decoration: none; text-align: center; padding: 12px 20px; border-radius: 8px; font-weight: 700; font-size: 14px; }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 25px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="email-container" style="max-width: 650px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    
    <!-- HEADER CORPORATIVO (IDÉNTICO A COTIZACIÓN) -->
    <div style="background: #0f172a; padding: 30px 25px; text-align: center; color: #ffffff;">
      <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/Stocka_1300_x_500_px_519_x_200_px_5.png?v=1779650350" alt="STOCKA Logo" style="height: 42px; margin-bottom: 12px; display: inline-block;">
      <h1 style="font-size: 20px; font-weight: 700; margin: 0; color: #ffffff; letter-spacing: 0.5px;">Propuesta y Servicios Fulfillment 360</h1>
      <div style="font-size: 13px; color: #94a3b8; margin-top: 5px;">Soluciones Integrales de Almacenamiento, Preparación y Despacho para Ecommerce</div>
    </div>

    <!-- BODY -->
    <div style="padding: 30px 25px;">
      <div style="font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">${displayGreeting}</div>
      
      <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 18px;">
        Muchas gracias por tu interés en los servicios de <strong>Fulfillment 360 de STOCKA</strong>. Te escribe <strong>Felipe Trujillo</strong>, Socio Fundador de <a href="https://stocka.cl" target="_blank" style="color: #5e17eb; font-weight: 700; text-decoration: underline;">Stocka.cl</a>.
        <br><br>
        En Stocka somos un partner logístico especializado en potenciar marcas online mediante un modelo de servicio <strong>integral, ágil y 100% escalable</strong>, diseñado para que puedas delegar la logística y concentrarte en el crecimiento de tus ventas:
      </p>

      ${customIntroMessage ? `
        <div style="background-color: #f5f3ff; border: 1px solid #ddd6fe; border-left: 4px solid #5e17eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; font-size: 13.5px; color: #4338ca; line-height: 1.5;">
          <strong>Mensaje personalizado:</strong><br>
          ${customIntroMessage.replace(/\n/g, '<br>')}
        </div>
      ` : ''}

      <!-- 4 PILARES CLAVE (ESTILO TARJETAS KPI DE COTIZACIÓN) -->
      <div style="display: table; width: 100%; margin-bottom: 10px;">
        <div style="display: table-cell; width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px 0 0 8px; border-right: none; padding: 14px 16px; vertical-align: top;">
          <div style="font-size: 14px; font-weight: 700; color: #5e17eb; margin-bottom: 4px;">📦 Almacenamiento Inteligente</div>
          <div style="font-size: 12px; color: #64748b; line-height: 1.45;">Paga únicamente por los metros cúbicos (m³) que utilizas. Sin contratos forzosos ni costos fijos desmedidos.</div>
        </div>
        <div style="display: table-cell; width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0 8px 8px 0; padding: 14px 16px; vertical-align: top;">
          <div style="font-size: 14px; font-weight: 700; color: #5e17eb; margin-bottom: 4px;">🏷️ Pick & Pack el Mismo Día</div>
          <div style="font-size: 12px; color: #64748b; line-height: 1.45;">Preparación ágil, etiquetado y packaging profesional de tus pedidos con horarios de corte extendidos.</div>
        </div>
      </div>

      <div style="display: table; width: 100%; margin-bottom: 22px;">
        <div style="display: table-cell; width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px 0 0 8px; border-right: none; padding: 14px 16px; vertical-align: top;">
          <div style="font-size: 14px; font-weight: 700; color: #5e17eb; margin-bottom: 4px;">🚚 Same Day RM & Todo Chile</div>
          <div style="font-size: 12px; color: #64748b; line-height: 1.45;">Entregas el mismo día en Santiago (incluyendo Mercado Libre Flex) y convenios preferenciales a todo Chile.</div>
        </div>
        <div style="display: table-cell; width: 50%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0 8px 8px 0; padding: 14px 16px; vertical-align: top;">
          <div style="font-size: 14px; font-weight: 700; color: #5e17eb; margin-bottom: 4px;">🔌 WMS & Integraciones 24/7</div>
          <div style="font-size: 12px; color: #64748b; line-height: 1.45;">Sincronización en tiempo real con Shopify, MeLi, WooCommerce, Jumpseller y control de inventario total.</div>
        </div>
      </div>

      <!-- PRESENTACIONES Y MATERIAL OFICIAL ADJUNTO (IDÉNTICO A COTIZACIÓN) -->
      <div style="margin: 22px 0 20px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 6px;">
          📚 Presentaciones Oficiales y Documentación Adjunta:
        </div>
        <p style="font-size: 12px; color: #64748b; margin: 0 0 14px 0; line-height: 1.4;">
          Adjuntamos los documentos en formato PDF a este correo y te dejamos los enlaces directos para abrirlos o descargarlos:
        </p>
        <div style="display: table; width: 100%; margin-bottom: 8px;">
          <div style="display: table-cell; width: 50%; padding-right: 5px;">
            <a href="${fulfillmentDocUrl}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              📦 <span style="color: #5e17eb;">Presentación Fulfillment 360</span> (PDF) ↗
            </a>
          </div>
          <div style="display: table-cell; width: 50%; padding-left: 5px;">
            <a href="${despachosDocUrl}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              🚚 <span style="color: #2563eb;">Presentación Despachos RM</span> (PDF) ↗
            </a>
          </div>
        </div>
        <a href="${courierFolderUrl}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
          🌐 <span style="color: #7c3aed;">Carpeta Online de Tarifarios Courier (Todo Chile)</span> ↗
        </a>
      </div>

      <!-- SIMULAR COTIZACIÓN ONLINE EN STOCKA (IDÉNTICO A COTIZACIÓN) -->
      <div style="margin: 20px 0 22px 0; background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 18px 20px; text-align: center;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 5px;">
          🧮 ¿Quieres simular tu cotización en menos de 1 minuto?
        </div>
        <p style="font-size: 12px; color: #64748b; margin: 0 0 14px 0; line-height: 1.45;">
          Ingresa tus estimaciones de pedidos mensuales y volumen de bodegaje para obtener un desglose detallado e instantáneo:
        </p>
        <a href="${cotizadorUrl}" target="_blank" style="display: inline-block; background: #ffffff; color: #5e17eb !important; border: 1.5px solid #5e17eb; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 13px; box-shadow: 0 2px 4px rgba(94, 23, 235, 0.06);">
          🔄 Simular Cotización Online en Stocka.cl ↗
        </a>
      </div>

      <!-- AGENDA UNA REUNIÓN PARA CONOCERNOS MEJOR (IDÉNTICO A COTIZACIÓN) -->
      <div style="margin: 22px 0 20px 0; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 22px 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.04); border-left: 4px solid #5e17eb;">
        <div style="margin-bottom: 10px;">
          <span style="display: inline-block; font-size: 11px; font-weight: 700; color: #5e17eb; background: rgba(94, 23, 235, 0.08); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(94, 23, 235, 0.2); margin-right: 8px;">
            ⏱ 20–30 min.
          </span>
          <span style="font-size: 12px; color: #64748b; font-weight: 600;">
            📹 Reunión vía Google Meet
          </span>
        </div>

        <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 6px; line-height: 1.3;">
          Agenda una reunión para conocernos mejor
        </div>
        
        <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0; line-height: 1.5;">
          Te recomendamos antes revisar nuestra presentación de servicios adjunta, así podremos conversar con mayor profundidad en lo que necesitas para tu comercio.
        </p>

        <div style="display: table; width: 100%; margin-bottom: 16px;">
          <div style="display: table-cell; width: 44px; vertical-align: middle;">
            <img src="https://wms.stocka.cl/images/felipe_avatar.png" alt="Felipe de Stocka.cl" width="40" height="40" style="border-radius: 50%; border: 2px solid #5e17eb; display: block;">
          </div>
          <div style="display: table-cell; vertical-align: middle; padding-left: 10px;">
            <div style="font-size: 13px; font-weight: 700; color: #0f172a;">Felipe de Stocka.cl</div>
            <div style="font-size: 11px; color: #64748b;">Socio Fundador / Asesoría Comercial 1 a 1</div>
          </div>
        </div>

        <a href="${meetingUrl}" target="_blank" style="display: block; background: #5e17eb; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(94,23,235,0.3);">
          👉 Programar una reunión vía Meet ↗
        </a>
      </div>

      <!-- BOTÓN WHATSAPP DIRECTO (IDÉNTICO A COTIZACIÓN) -->
      <a href="https://wa.me/56939247487?text=${encodeURIComponent(`Hola Felipe, te escribo respecto a la presentación de servicios de Fulfillment de Stocka.`)}" target="_blank" style="display: block; background: #25d366; color: #ffffff !important; text-decoration: none; text-align: center; padding: 12px 20px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 14px;">
        💬 Coordinar Asesoría Comercial por WhatsApp (+56 9 3924 7487)
      </a>

    </div>

    <!-- FOOTER OFICIAL STOCKA (IDÉNTICO A COTIZACIÓN) -->
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 25px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5;">
      <strong>STOCKA SpA</strong> • Soluciones Integrales de Fulfillment y Bodegaje en Chile<br>
      Sitio web: <a href="https://stocka.cl" style="color: #5e17eb;">stocka.cl</a> • Portal WMS: <a href="https://wms.stocka.cl" style="color: #5e17eb;">wms.stocka.cl</a><br>
      Email: <a href="mailto:contacto@stocka.cl" style="color: #5e17eb;">contacto@stocka.cl</a> • WhatsApp: +56 9 3924 7487
    </div>

  </div>
</body>
</html>
      `.trim();
    }
    else if (emailType === 'onboarding_e1_instructions' || emailType === 'onboarding_e1') {
      const contactGreeting = payload.contactName || payload.nombreContacto || payload.nombre_contacto || payload.nombre || payload.full_name || '';
      const displayGreeting = contactGreeting 
        ? `Hola <strong>${contactGreeting}</strong> buen día, ¿cómo estás?` 
        : `Hola, buen día, ¿cómo estás?`;
      
      const displayCommerce = commerceName && commerceName !== 'Cliente WMS' && commerceName !== 'Comercio' ? ` - ${commerceName}` : '';
      emailSubject = `Instrucciones de Onboarding y Alta en Fulfillment - Stocka${displayCommerce}`;
      headerGradient = 'linear-gradient(135deg, #5e17eb, #7c3aed)';
      emailTitle = 'Instrucciones de Onboarding';

      // Consultar adjuntos de la carpeta E1 en service_docs
      let e1ResourcesHtml = '';
      try {
        const { data: e1Docs } = await supabaseClient
          .from('service_docs')
          .select('name, file_url')
          .in('folder', ['E1', 'E1_General', 'E1_Onboarding', 'ONBOARDING_E1']);

        if (e1Docs && e1Docs.length > 0) {
          e1ResourcesHtml = `
            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px 18px; margin-top: 18px; margin-bottom: 18px; font-size: 13.5px; color: #166534; line-height: 1.6;">
              <strong style="color: #14532d; display: block; margin-bottom: 8px; font-size: 14px;">
                📎 Archivos Adjuntos y Descargas Directas:
              </strong>
              Los siguientes documentos van adjuntos en PDF y también puedes abrirlos directamente aquí:
              <ul style="margin: 6px 0; padding-left: 20px;">
          `;
          e1Docs.forEach((doc: any) => {
            e1ResourcesHtml += `
              <li style="margin-bottom: 5px;">
                <a href="${doc.file_url}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">
                  📄 ${doc.name} (Descargar PDF)
                </a>
              </li>
            `;
          });
          e1ResourcesHtml += `
              </ul>
            </div>
          `;
        }
      } catch (err) {
        console.error('[send-billing-email] Error cargando enlaces E1 para cuerpo de correo:', err);
      }

      emailBodyHtml = `
        <div style="font-size: 14.5px; color: #1e293b; margin-bottom: 20px; line-height: 1.6;">
          ${displayGreeting}, te escribimos de parte de <a href="https://stocka.cl" target="_blank" style="color: #5e17eb; font-weight: 600; text-decoration: underline;">stocka.cl</a> para agradecerte el contacto y tu interés en sumarte a nuestro servicio de <strong>Fulfillment 360</strong>. ¡Te damos una tremenda bienvenida!
          <br><br>
          Esperamos ser un partner estratégico que impulse el crecimiento de tu comercio. A continuación, te explicamos los pasos a seguir para darte de alta e iniciar operaciones:
        </div>

        <!-- PASO 1 -->
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #5e17eb; border-radius: 8px; padding: 16px 18px; margin-bottom: 14px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; font-size: 14.5px; display: block; margin-bottom: 6px;">
            📝 PASO 1: Registro en Plataforma WMS (Onboarding Online)
          </strong>
          Ingresa al enlace <a href="https://wms.stocka.cl/onboarding" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: underline;">https://wms.stocka.cl/onboarding</a> y completa el formulario de solicitud con los datos de tu empresa, tienda online, preferencias logísticas y de contacto.
        </div>

        <!-- PASO 2 -->
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 16px 18px; margin-bottom: 14px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; font-size: 14.5px; display: block; margin-bottom: 6px;">
            ✍️ PASO 2: Confirmación de Email y Firma de Contrato Digital
          </strong>
          Tras registrarte recibirás un email para confirmar tu cuenta. En el portal podrás descargar los contratos del servicio, firmarlos y cargarlos en la plataforma.<br><br>
          Una vez revisada la documentación te confirmaremos la habilitación vía email. Podrás consultar el avance ingresando a <a href="https://wms.stocka.cl" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">wms.stocka.cl</a> con tu correo y contraseña.
        </div>

        <!-- PASO 3 -->
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #10b981; border-radius: 8px; padding: 16px 18px; margin-bottom: 14px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; font-size: 14.5px; display: block; margin-bottom: 6px;">
            🔌 PASO 3: Integración de Canales de Venta y Catálogo
          </strong>
          Con tus credenciales activas, ingresa al módulo de <strong>Integraciones</strong> para conectar tus canales (Shopify, WooCommerce, Mercado Libre, Jumpseller, etc.). Nuestro equipo se encargará de vincular tu catálogo en el WMS para habilitar tu primer ingreso de stock.
        </div>

        <!-- PASO 4 -->
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px 18px; margin-bottom: 14px; font-size: 13.5px; color: #334155; line-height: 1.6;">
          <strong style="color: #0f172a; font-size: 14.5px; display: block; margin-bottom: 6px;">
            📦 PASO 4: Declaración de Stock y Recepción en Bodega
          </strong>
          Crea tu solicitud de ingreso en la plataforma: podrás solicitar retiro dentro de Santiago o despachar directamente a la bodega asignada. Podrás realizar seguimiento en tiempo real de todo el proceso de recepción.
        </div>

        <!-- CENTRO DE DOCUMENTACION -->
        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 18px; margin-top: 16px; margin-bottom: 12px; font-size: 13px; color: #1e40af; line-height: 1.5;">
          📚 <strong>Centro de Documentación:</strong> Recuerda que en la sección <strong>Documentación</strong> de tu portal WMS tendrás acceso permanente a todas las guías e información oficial de los servicios de fulfillment.
        </div>

        <!-- NOTA ADJUNTOS -->
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; margin-top: 12px; margin-bottom: 12px; font-size: 13px; color: #334155; line-height: 1.5;">
          📄 <strong>Documentos adjuntos:</strong> Te compartimos la <strong>Presentación del Servicio</strong> (con información relevante para ingresar tu comercio a Fulfillment 360) y el <strong>Tarifario Vigente</strong> del servicio.
        </div>

        ${e1ResourcesHtml}

        <div style="font-size: 14px; color: #334155; margin-top: 20px; line-height: 1.6;">
          Cualquier consulta o apoyo que necesites estamos a tu total disposición.<br><br>
          ¡Saludos cordiales y mucho éxito!<br>
          <strong>Equipo Stocka</strong><br>
          <a href="https://stocka.cl" target="_blank" style="color: #5e17eb; text-decoration: none; font-weight: 600;">stocka.cl</a>
        </div>
      `;
    }
    else if (emailType === 'onboarding_observed') {
      emailSubject = `Acción requerida: Observaciones en tu solicitud de alta - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #f97316, #d97706)';
      emailTitle = 'Solicitud Pendiente de Corrección';
      
      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Hemos revisado tu solicitud de alta y se han detectado algunas <strong>observaciones que requieren tu atención</strong> antes de proceder con la activación.
        </div>
        
        <div style="background-color: #fff7ed; border: 1px solid #ffedd5; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #c2410c; line-height: 1.5;">
          <strong style="display: block; margin-bottom: 5px;">Detalle de Observaciones:</strong>
          <span style="font-style: italic; color: #475569;">${customMessage || 'Por favor revisa el portal para ver las observaciones.'}</span>
        </div>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          Para resolver esto, simplemente inicia sesión en el portal WMS con tu cuenta, revisa el detalle del estado y utiliza el botón de corregir para actualizar tu información o contrato firmado.
        </div>
      `;
    }
    else if (emailType === 'onboarding_admin_notification') {
      emailSubject = `[Onboarding WMS] Nueva Solicitud de Alta - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #4f46e5, #06b6d4)';
      emailTitle = 'Nueva Solicitud de Onboarding';
      
      const details = onboardingDetails || {};
      
      const annexes = details.acceptedAnnexes || [];
      let annexesHtml = '';
      if (Array.isArray(annexes) && annexes.length > 0) {
        annexesHtml = `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 10px; font-weight: 600; color: #475569; vertical-align: top;">Anexos Aceptados:</td>
            <td style="padding: 10px; color: #1e293b;">
              <ul style="margin: 0; padding-left: 20px; line-height: 1.5; font-size: 13px;">
                ${annexes.map((annex: any) => {
                  const formattedDate = annex.document_date ? annex.document_date.split('-').reverse().join('/') : 'S/F';
                  return `<li><strong>${annex.name}</strong> (Fecha: ${formattedDate}) - <a href="${annex.file_url}" target="_blank" style="color: #2563eb; text-decoration: underline;">Descargar</a></li>`;
                }).join('')}
              </ul>
            </td>
          </tr>
        `;
      }

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Se ha recibido una nueva solicitud de alta comercial en el portal de Onboarding. A continuación se detallan los datos registrados por el cliente:
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13.5px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
          <thead>
            <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <th style="padding: 10px; text-align: left; color: #475569; font-weight: 700; width: 180px;">Campo</th>
              <th style="padding: 10px; text-align: left; color: #475569; font-weight: 700;">Detalle Registrado</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Marca / Fantasía:</td>
              <td style="padding: 10px; color: #1e293b; font-weight: 700;">${commerceName}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Razón Social:</td>
              <td style="padding: 10px; color: #1e293b;">${details.razonSocial || 'No especificada'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">RUT Empresa:</td>
              <td style="padding: 10px; color: #1e293b;">${details.rutEmpresa || 'No especificado'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Contacto:</td>
              <td style="padding: 10px; color: #1e293b;">${details.contactName || 'No especificado'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Email Contacto:</td>
              <td style="padding: 10px; color: #1e293b;"><a href="mailto:${details.contactEmail || ''}" style="color: #2563eb; text-decoration: none;">${details.contactEmail || 'No especificado'}</a></td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Teléfono:</td>
              <td style="padding: 10px; color: #1e293b;">${details.phone || 'No especificado'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Giro Comercial:</td>
              <td style="padding: 10px; color: #1e293b;">${details.giroComercio || 'No especificado'}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Dirección:</td>
              <td style="padding: 10px; color: #1e293b;">${details.direccion || 'No especificada'}, ${details.comuna || ''}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px; font-weight: 600; color: #475569;">Contrato Firmado:</td>
              <td style="padding: 10px; color: #1e293b;">
                ${details.contratoUrl ? `<a href="${details.contratoUrl}" target="_blank" style="color: #2563eb; font-weight: 600; text-decoration: underline;">Descargar PDF Contrato</a>` : 'No adjuntado'}
              </td>
            </tr>
            ${annexesHtml}
          </tbody>
        </table>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-top: 20px;">
          Por favor, inicia sesión como administrador en el portal WMS de Stocka para revisar, observar o aprobar esta solicitud.
        </div>
      `;
    }
    else if (emailType === 'stock_inbound_created') {
      const decTitle = payload.title || "Ingreso de Stock";
      const decCommerce = payload.comercio || commerceName || "Cliente WMS";
      const qtyDeclared = payload.quantityDeclared || payload.quantity_declared || 0;
      const packageCount = payload.packageCount || payload.package_count || 0;
      const packageType = payload.packageType || payload.package_type || "Cajas";
      const deliveryMethod = payload.deliveryMethod || payload.delivery_method || "No especificado";
      const carrierInfo = payload.carrierInfo || payload.carrier_info || payload.contactInfo || payload.contact_info || "No especificado";
      const notes = payload.notes || "Sin observaciones del cliente";
      const decId = payload.declarationId || "";
      const shortCode = decId ? `#ING-${decId.substring(0, 8).toUpperCase()}` : 'N/A';

      let arrivalInfo = "No especificado";
      if (payload.estimatedArrivalDate || payload.estimated_arrival_date) {
        arrivalInfo = `Fecha exacta: ${payload.estimatedArrivalDate || payload.estimated_arrival_date}`;
      } else if (payload.estimatedArrivalPeriod || payload.estimated_arrival_period) {
        arrivalInfo = `Plazo estimado: ${payload.estimatedArrivalPeriod || payload.estimated_arrival_period}`;
      }

      emailSubject = `[NUEVO INGRESO DE STOCK ${shortCode}] ${decCommerce} - ${decTitle}`;
      headerGradient = 'linear-gradient(135deg, #0d9488, #0f766e)';
      emailTitle = 'Nuevo Ingreso de Stock Creado';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo <strong>Stocka</strong>,<br><br>
          El usuario del comercio <strong>${decCommerce}</strong> acaba de registrar una nueva declaración de <strong>ingreso de stock</strong> en la plataforma WMS.
        </div>

        <div style="background-color: #f0fdf4; border: 1px solid #ccfbf1; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 12px 0; font-size: 15px; color: #0f766e; font-weight: 700;">Detalles del Ingreso Registrado:</h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600; width: 40%;">Código Único:</td><td style="padding: 8px 0; font-weight: 700; color: #2563eb; font-family: monospace;">${shortCode}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600; width: 40%;">Comercio / Cliente:</td><td style="padding: 8px 0; font-weight: 700; color: #1e293b;">${decCommerce}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Título / Referencia:</td><td style="padding: 8px 0; font-weight: 600; color: #0f766e;">${decTitle}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Unidades Declaradas:</td><td style="padding: 8px 0;"><span style="background-color: #ccfbf1; color: #0f766e; padding: 3px 8px; border-radius: 4px; font-weight: 700;">${qtyDeclared} unidades</span></td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Bultos / Empaque:</td><td style="padding: 8px 0;">${packageCount} (${packageType})</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Fecha / Plazo de Arribo:</td><td style="padding: 8px 0;">${arrivalInfo}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Método de Entrega:</td><td style="padding: 8px 0;">${deliveryMethod}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Transporte / Contacto:</td><td style="padding: 8px 0;">${carrierInfo}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600;">Notas del Cliente:</td><td style="padding: 8px 0; font-style: italic;">${notes}</td></tr>
          </table>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Gestión en Bodega:</strong><br>
          Puedes revisar, asignar bodega o recepcionar esta declaración directamente ingresando al módulo de <strong>Ingresos de Stock</strong> en el panel WMS Admin.
        </div>
      `;
    }
    else if (emailType === 'shopify_pin_submitted') {
      const pin = payload.shopifyPin || payload.pin || 'N/A';
      const shopUrl = payload.shopUrl || payload.shop_url || 'No especificada';
      emailSubject = `[WMS STOCKA] Código PIN Shopify Partner - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #111827, #5e17eb)';
      emailTitle = 'Código PIN Shopify Partner';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          El comercio <strong>${commerceName}</strong> ha ingresado su código PIN de seguridad de 4 dígitos desde la Guía Interactiva WMS:
        </div>

        <div style="background-color: #f3f4f6; border-left: 4px solid #5e17eb; padding: 16px 20px; margin: 20px 0; border-radius: 6px; text-align: center;">
          <span style="font-size: 12px; color: #6b7280; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">Código PIN de Seguridad (4 Dígitos)</span>
          <span style="font-size: 32px; font-family: monospace; font-weight: 800; color: #5e17eb; letter-spacing: 0.25em;">${pin}</span>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: 600; width: 140px;">Comercio:</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 700;">${commerceName}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-weight: 600;">Tienda Shopify:</td>
            <td style="padding: 8px 0; color: #111827; font-weight: 700;">${shopUrl}</td>
          </tr>
        </table>
      `;
    }
    else if (emailType === 'out_of_stock') {
      const sku = payload.sku || 'N/A';
      const productName = payload.productName || 'N/A';
      emailSubject = `[ALERTA STOCK] Producto Agotado - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #ef4444, #b91c1c)';
      emailTitle = 'Alerta de Producto Agotado';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo de <strong>${commerceName}</strong>,<br><br>
          Te informamos que un producto en tu inventario WMS se ha quedado sin stock disponible:
        </div>
        <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; font-weight: 600; width: 40%;">SKU:</td><td style="padding: 8px 0; font-weight: 700; color: #b91c1c;">${sku}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; font-weight: 600;">Producto:</td><td style="padding: 8px 0; font-weight: 600;">${productName}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600;">Detalle:</td><td style="padding: 8px 0;">El stock disponible en sistema ha llegado a 0.</td></tr>
          </table>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Gestión:</strong> Puedes reabastecer inventario creando una nueva declaración en el módulo <strong>Ingresos de Stock</strong>.
        </div>
      `;
    }
    else if (emailType === 'critical_stock_report') {
      const reportHtml = payload.reportHtml || '<p style="color:#64748b; font-size:13.5px;">No se encontraron productos en nivel crítico.</p>';
      emailSubject = `[REPORTE] Productos en Nivel Crítico - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #f59e0b, #d97706)';
      emailTitle = 'Reporte de Productos en Nivel Crítico';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          A continuación, te presentamos el reporte periódico de productos que se encuentran agotados o cercanos al nivel crítico establecido en tu catálogo:
        </div>
        <div style="margin-bottom: 20px;">
          ${reportHtml}
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #fffbeb; border: 1px solid #fef3c7; color: #78350f; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Consejo:</strong> Puedes modificar las cantidades críticas ingresando a la vista del catálogo de productos y editando las propiedades de cada SKU.
        </div>
      `;
    }
    else if (emailType === 'incident_report') {
      const incidentTitle = payload.incidentTitle || 'N/A';
      const incidentType = payload.incidentType || 'N/A';
      const incidentSeverity = payload.incidentSeverity || 'N/A';
      const incidentDescription = payload.incidentDescription || 'N/A';
      
      emailSubject = `[NUEVA INCIDENCIA] Registro de Incidencia en Portal - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #3b82f6, #1d4ed8)';
      emailTitle = 'Nueva Incidencia Registrada';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo de <strong>${commerceName}</strong>,<br><br>
          Se ha registrado una nueva incidencia en tu portal WMS relacionada con tus operaciones:
        </div>
        <div style="background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600; width: 40%;">Título:</td><td style="padding: 8px 0; font-weight: 700; color: #1d4ed8;">${incidentTitle}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Tipo:</td><td style="padding: 8px 0;">${incidentType}</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Severidad:</td><td style="padding: 8px 0; font-weight: 600;">${incidentSeverity}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600;">Detalle:</td><td style="padding: 8px 0; font-style: italic;">${incidentDescription}</td></tr>
          </table>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          Puedes revisar o comentar esta incidencia ingresando directamente al módulo de <strong>Incidencias</strong> en la plataforma.
        </div>
      `;
    }
    else if (emailType === 'volume_alert') {
      const currentVolume = payload.currentVolume || '0';
      const minVolumeLimit = payload.minVolumeLimit || 'No definido';
      const maxVolumeLimit = payload.maxVolumeLimit || 'No definido';

      emailSubject = `[ALERTA VOLUMEN] Nivel de volumen de stock - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
      emailTitle = 'Alerta de Nivel de Volumen';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo de <strong>${commerceName}</strong>,<br><br>
          Te notificamos que el volumen de tu stock total almacenado en bodega se encuentra fuera de los límites deseables:
        </div>
        <div style="background-color: #f5f3ff; border: 1px solid #eedeff; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600; width: 50%;">Volumen Actual Almacenado:</td><td style="padding: 8px 0; font-weight: 700; color: #6d28d9;">${currentVolume} m³</td></tr>
            <tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 0; font-weight: 600;">Límite Mínimo Configurado:</td><td style="padding: 8px 0;">${minVolumeLimit} m³</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600;">Límite Máximo Configurado:</td><td style="padding: 8px 0;">${maxVolumeLimit} m³</td></tr>
          </table>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          Puedes revisar el desglose por producto y el historial del volumen en el módulo de <strong>Volumen Diario</strong>.
        </div>
      `;
    }
    else if (emailType === 'weekly_sales_report') {
      const salesHtml = payload.salesHtml || '<p style="color:#64748b; font-size:13.5px;">No se registraron ventas en este período.</p>';
      emailSubject = `[REPORTE] Ventas Semanales de Pedidos - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #10b981, #059669)';
      emailTitle = 'Reporte Semanal de Ventas';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Aquí tienes el resumen semanal de las ventas y pedidos procesados en la plataforma, desglosado por canal de origen:
        </div>
        <div style="margin-bottom: 20px;">
          ${salesHtml}
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          Para ver el listado detallado de pedidos por fecha, estado y canal, entra al módulo de <strong>Pedidos</strong>.
        </div>
      `;
    }
    else if (emailType === 'monthly_activity_report') {
      const activityHtml = payload.activityHtml || '<p style="color:#64748b; font-size:13.5px;">Sin actividad registrada en el período.</p>';
      emailSubject = `[REPORTE] Resumen Mensual de Despachos y Devoluciones - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #3b82f6, #2563eb)';
      emailTitle = 'Resumen Mensual de Actividad';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Te presentamos el informe mensual consolidado de despachos realizados y devoluciones de logística inversa gestionadas:
        </div>
        <div style="margin-bottom: 20px;">
          ${activityHtml}
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          Este reporte mensual consolida la actividad útil para el control administrativo de fulfillment y logística de devoluciones.
        </div>
      `;
    }
    else if (emailType === 'order_no_stock_alert') {
      const orderId = payload.orderId || 'N/A';
      const orderSource = payload.orderSource || 'N/A';
      const missingProductsList = payload.missingProductsList || 'N/A';

      emailSubject = `[ALERTA PEDIDO] Pedido sin stock disponible - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #ef4444, #dc2626)';
      emailTitle = 'Alerta de Pedido Sin Stock';

      emailBodyHtml = `
        <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Hola equipo de <strong>${commerceName}</strong>,<br><br>
          Te notificamos que un nuevo pedido ingresado al sistema no se ha podido procesar debido a falta de stock de uno o más de sus productos:
        </div>
        <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13.5px; color: #334155;">
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; font-weight: 600; width: 40%;">ID Pedido:</td><td style="padding: 8px 0; font-weight: 700; color: #dc2626;">${orderId}</td></tr>
            <tr style="border-bottom: 1px solid #f1f5f9;"><td style="padding: 8px 0; font-weight: 600;">Canal Origen:</td><td style="padding: 8px 0;">${orderSource}</td></tr>
            <tr><td style="padding: 8px 0; font-weight: 600;">Productos Faltantes:</td><td style="padding: 8px 0; font-weight: 600; color: #b91c1c;">${missingProductsList}</td></tr>
          </table>
        </div>
      `;

      mainNoticeHtml = `
        <div style="margin-top: 25px; padding: 15px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #475569; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          Te recomendamos ingresar stock de estos productos o revisar la orden en el módulo de <strong>Pedidos</strong>.
        </div>
      `;
    }
    else {
      if (resolvedServiceType === 'fulfillment') {
        emailSubject = `${isCorrection ? '[CORRECCION]' : '[Facturación]'} Desglose de servicios Fulfillment ${periodName} - ${commerceName}`;
      } else if (resolvedServiceType === 'enviame') {
        emailSubject = `${isCorrection ? '[CORRECCION]' : '[Facturación]'} Desglose de despachos Enviame ${periodName} - ${commerceName}`;
      } else {
        emailSubject = `${isCorrection ? '[CORRECCION]' : '[Facturación]'} Desglose de servicios Fulfillment y Envíame ${periodName} - ${commerceName}`;
      }
      headerGradient = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
      emailTitle = 'Resumen de Facturación';

      let correctionNoticeHtml = '';
      if (isCorrection) {
        correctionNoticeHtml = `
          <div style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 15px; margin-bottom: 20px; color: #991b1b; font-size: 14px; line-height: 1.5;">
            <div style="font-weight: 700; margin-bottom: 5px; font-size: 15px;">⚠️ CORRECCIÓN DE FACTURACIÓN</div>
            Estimado equipo, le informamos que el correo enviado anteriormente para este periodo contenía errores en los montos indicados debido a un proceso de migración de nuestros sistemas. 
            El presente correo contiene el desglose y la información <strong>correcta y definitiva</strong>. Lamentamos profundamente las molestias e inconvenientes que esto pueda ocasionarle.
          </div>
        `;
      }

      emailBodyHtml = `
        ${correctionNoticeHtml}
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Le informamos que el desglose de servicios de facturación correspondiente a <strong>${periodName}</strong> ya se encuentra disponible para su revisión.
        </div>
        
        ${servicesHtml}
        
        <div style="margin-top: 25px; padding: 15px; background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 15px; font-weight: 700; color: #1e3a8a;">Total a Pagar:</span>
          <span style="font-size: 20px; font-weight: 800; color: #1e3a8a;">${formatCLP(totalMonto)}</span>
        </div>

        ${appealDeadlineNote}

        ${paymentDetailsHtml}
      `;

      mainNoticeHtml = `
        <div style="margin-top: 30px; padding: 15px; background-color: #fffbeb; border: 1px solid #fef3c7; color: #78350f; border-radius: 8px; font-size: 13px; line-height: 1.6;">
          <strong>Información Importante:</strong><br>
          Los pagos realizados dentro del plazo establecido son fundamentales para mantener la continuidad de sus servicios sin interrupciones.<br><br>
          Si desea realizar alguna observación, apelación o adjuntar su comprobante de pago, le invitamos a hacerlo directamente desde el módulo de Facturación en el sistema WMS.
        </div>
      `;
    }

    let customMsgHtml = '';
    if (customMessage && customMessage.trim()) {
      customMsgHtml = `
        <div style="margin: 20px 0; padding: 15px; background-color: #f1f5f9; border-left: 4px solid #94a3b8; font-size: 13.5px; color: #334155; line-height: 1.5; border-radius: 0 8px 8px 0;">
          <strong>Nota de Finanzas:</strong><br>
          ${customMessage.replace(/\n/g, '<br>')}
        </div>
      `;
    }

    const infoSenderTypes = [
      'onboarding_received', 
      'onboarding_contract_received', 
      'onboarding_approved', 
      'onboarding_observed', 
      'onboarding_admin_notification', 
      'stock_inbound_created',
      'stock_inbound_warehouse_assigned',
      'stock_inbound_received',
      'stock_inbound_completed',
      'out_of_stock',
      'critical_stock_report',
      'incident_report',
      'volume_alert',
      'weekly_sales_report',
      'monthly_activity_report',
      'order_no_stock_alert',
      'onboarding_enviame_instructions',
      'onboarding_e1_instructions',
      'onboarding_e1'
    ];
    const useInfoSender = infoSenderTypes.includes(emailType);
    const finalRecipients = emailType === 'shopify_pin_submitted' 
      ? ["stockachile@gmail.com"] 
      : (recipientEmails && recipientEmails.length > 0 ? recipientEmails : ["stockachile@gmail.com"]);

    if (emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info') {
      // htmlBody ya fue generado de forma autónoma e idéntica a la línea gráfica de cotizaciones
    } else if (useInfoSender) {
      // Corporativo Stocka (Purple / System / Operations)
      htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
  <div style="width: 100%; background-color: #f3f4f6; padding: 40px 0;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); overflow: hidden;">
      
      <!-- BRAND ACCENT BAR -->
      <div style="height: 6px; background: linear-gradient(90deg, #5e17eb, #8b5cf6);"></div>

      <!-- HEADER MINIMALISTA CORPORATIVO -->
      <div style="padding: 35px 30px 15px 30px; text-align: center; background-color: #ffffff;">
        <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka Logo" style="height: 48px; margin-bottom: 20px; display: inline-block;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #1e1b4b; letter-spacing: -0.5px;">${emailTitle}</h1>
        <p style="margin: 6px 0 0 0; font-size: 13.5px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">${commerceName}</p>
      </div>
      
      <!-- CONTENT -->
      <div style="padding: 10px 30px 30px 30px;">
        ${emailBodyHtml}
        
        ${customMsgHtml}
        
        <!-- BUTTON ACCEDER A WMS STOCKA (Explicit inline color with !important to prevent email client override) -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://stocka-wms.netlify.app/dashboard.html" target="_blank" style="display: inline-block; background-color: #5e17eb; color: #ffffff !important; padding: 12px 28px; font-size: 15px; font-weight: 600; border-radius: 8px; text-decoration: none; text-align: center; box-shadow: 0 4px 10px rgba(94, 23, 235, 0.25);">Acceder a WMS Stocka</a>
        </div>
        
        ${mainNoticeHtml}
      </div>
      
      <!-- FOOTER -->
      <div style="background-color: #f9fafb; padding: 30px 20px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #f3f4f6; line-height: 1.6;">
        <strong style="color: #111827; font-size: 13px;">Stocka SpA</strong><br>
        Fulfillment & Soporte Logístico para Ecommerce<br>
        Campo de Deportes 405, Ñuñoa.<br>
        <span style="display: block; margin-top: 12px; font-size: 11px; color: #9ca3af;">¿Tienes dudas? Escríbenos a: <a href="mailto:contacto@stocka.cl" style="color: #5e17eb; text-decoration: none; font-weight: 700;">contacto@stocka.cl</a></span>
      </div>
      
    </div>
  </div>
</body>
</html>
      `;
    } else {
      // Facturación Tradicional (Blue / Finance)
      htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; -webkit-font-smoothing: antialiased;">
  <div style="width: 100%; background-color: #f8fafc; padding: 40px 0;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); overflow: hidden;">
      
      <!-- HEADER -->
      <div style="background: ${headerGradient}; padding: 30px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #ffffff !important;">${emailTitle}</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9; color: #ffffff !important;">${periodName} - ${commerceName}</p>
      </div>
      
      <!-- CONTENT -->
      <div style="padding: 30px;">
        ${emailBodyHtml}
        
        ${customMsgHtml}
        
        <!-- BUTTON ACCEDER A WMS STOCKA (Explicit inline color with !important to prevent email client override) -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://stocka-wms.netlify.app/dashboard.html" target="_blank" style="display: block; background-color: #2563eb; color: #ffffff !important; padding: 12px 24px; font-size: 15px; font-weight: 600; border-radius: 8px; text-decoration: none; text-align: center; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.2); text-shadow: 0 1px 1px rgba(0,0,0,0.2);">Acceder a WMS Stocka</a>
        </div>
        
        ${mainNoticeHtml}
      </div>
      
      <!-- FOOTER -->
      <div style="background-color: #f1f5f9; padding: 25px 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; line-height: 1.6;">
        <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/newlogotransp.png?v=1779852093" alt="Stocka Logo" style="height: 38px; margin-bottom: 12px; display: inline-block;"><br>
        <strong style="color: #1e293b;">Stocka SpA</strong><br>
        Logística y Fulfillment Ecommerce<br>
        Campo de Deportes 405, Ñuñoa.<br>
        <span style="display: block; margin-top: 10px; font-size: 11px; color: #94a3b8;">Contacto Finanzas: <a href="mailto:finanzas@stocka.cl" style="color: #2563eb; text-decoration: none; font-weight: 600;">finanzas@stocka.cl</a></span>
      </div>
      
    </div>
  </div>
</body>
</html>
      `;
    }

    const senderEmail = (emailType === 'onboarding_enviame_instructions' || emailType === 'onboarding_e1_instructions' || emailType === 'onboarding_e1' || emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info')
      ? 'contacto@stocka.cl'
      : (useInfoSender ? 'info@stocka.cl' : 'finanzas@stocka.cl');

    const senderName = (emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info')
      ? "Felipe Trujillo - Stocka Fulfillment"
      : (emailType === 'stock_inbound_created' ? "Sistema WMS Stocka" : (useInfoSender ? "Stocka" : "Finanzas Stocka"));

    const brevoPayload: any = {
      sender: {
        name: senderName,
        email: senderEmail
      },
      to: finalRecipients.map(email => ({ email })),
      subject: emailSubject,
      htmlContent: htmlBody
    };

    if (emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info') {
      brevoPayload.replyTo = { email: 'felipe.tp@stocka.cl', name: 'Felipe Trujillo' };
      brevoPayload.bcc = [
        { email: 'felipe.tp@stocka.cl', name: 'Felipe Trujillo' },
        { email: 'stockachile@gmail.com', name: 'Stocka Chile' }
      ];
    }

    // Soporte para destinatarios en copia (CC)
    const rawCc = payload.cc || payload.ccEmails || payload.cc_emails;
    let ccList: string[] = [];
    if (Array.isArray(rawCc)) {
      ccList = rawCc.map((e: any) => (typeof e === 'string' ? e : e?.email || '')).filter(Boolean);
    } else if (typeof rawCc === 'string' && rawCc.trim()) {
      ccList = rawCc.split(/[,;\s]+/).map((e: string) => e.trim()).filter(Boolean);
    }

    const validCc = ccList
      .map((e: string) => e.toLowerCase().trim())
      .filter((e: string) => e.includes('@') && e.includes('.'));

    if (validCc.length > 0) {
      brevoPayload.cc = validCc.map((email: string) => ({ email }));
      console.log(`[send-billing-email] Agregados ${validCc.length} destinatarios en copia (CC): ${validCc.join(', ')}`);
    }

    if (payload.fileBase64 && payload.fileName) {
      brevoPayload.attachment = [
        {
          content: payload.fileBase64,
          name: payload.fileName
        }
      ];
    }

    // Si es onboarding_approved y viene contratoUrl, descargar y adjuntar
    const contratoUrl = payload.contratoUrl || payload.contrato_url;
    if (emailType === 'onboarding_approved' && contratoUrl) {
      try {
        console.log(`[send-billing-email] Intentando descargar contrato definitivo desde: ${contratoUrl}`);
        const fileRes = await fetch(contratoUrl);
        if (fileRes.ok) {
          const arrayBuffer = await fileRes.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          const base64Content = btoa(new TextDecoder('latin1').decode(uint8));

          if (!brevoPayload.attachment) {
            brevoPayload.attachment = [];
          }

          // Nombre del archivo sanitizado
          const sanitizedCommerceName = (commerceName || 'Comercio').replace(/[^a-zA-Z0-9]/g, '_');
          brevoPayload.attachment.push({
            content: base64Content,
            name: `Contrato_Definitivo_${sanitizedCommerceName}.pdf`
          });
          console.log(`[send-billing-email] Contrato definitivo adjuntado con éxito!`);
        } else {
          console.error(`[send-billing-email] Error al descargar contrato: HTTP ${fileRes.status}`);
        }
      } catch (err) {
        console.error(`[send-billing-email] Error descargando/adjuntando contrato:`, err);
      }
    }

    // Si es onboarding_enviame_instructions (correo E3), consultar y adjuntar dinámicamente los archivos de la carpeta E3
    if (emailType === 'onboarding_enviame_instructions') {
      try {
        // Por ahora, como el correo E3 es de Shopify, adjuntamos los archivos de 'E3' / 'E3_General' y 'E3_Shopify'
        const { data: e3Docs, error: e3Err } = await supabaseClient
          .from('service_docs')
          .select('name, file_url')
          .in('folder', ['E3', 'E3_General', 'E3_Shopify']);

        if (!e3Err && e3Docs && e3Docs.length > 0) {
          console.log(`[send-billing-email] Encontrados ${e3Docs.length} documentos en la carpeta E3.`);
          for (const doc of e3Docs) {
            try {
              console.log(`[send-billing-email] Descargando adjunto E3: ${doc.name} desde ${doc.file_url}`);
              const fileRes = await fetch(doc.file_url);
              if (fileRes.ok) {
                const arrayBuffer = await fileRes.arrayBuffer();
                const sizeInMB = arrayBuffer.byteLength / (1024 * 1024);

                if (sizeInMB < 4.0) {
                  const uint8 = new Uint8Array(arrayBuffer);
                  const base64Content = btoa(new TextDecoder('latin1').decode(uint8));

                  if (!brevoPayload.attachment) {
                    brevoPayload.attachment = [];
                  }

                  // Asegurar que el nombre tenga la extensión adecuada si la URL la tiene
                  let docName = doc.name;
                  if (!docName.toLowerCase().endsWith('.pdf') && doc.file_url.toLowerCase().endsWith('.pdf')) {
                    docName += '.pdf';
                  }

                  brevoPayload.attachment.push({
                    content: base64Content,
                    name: docName
                  });
                  console.log(`[send-billing-email] Adjunto E3 ${docName} cargado con éxito (${sizeInMB.toFixed(2)} MB).`);
                } else {
                  console.log(`[send-billing-email] Omitiendo adjunto físico por superar los 4MB (disponible por link): ${doc.name} (${sizeInMB.toFixed(2)} MB).`);
                }
              } else {
                console.warn(`[send-billing-email] Adjunto opcional E3 ${doc.name} no se pudo descargar: HTTP ${fileRes.status}`);
              }
            } catch (err) {
              console.error(`[send-billing-email] Error descargando adjunto E3 ${doc.name}:`, err);
            }
          }
        } else {
          console.log(`[send-billing-email] No se encontraron documentos en la carpeta E3 en la base de datos:`, e3Err);
        }
      } catch (dbErr) {
        console.error(`[send-billing-email] Error al consultar adjuntos E3:`, dbErr);
      }
    }

    // Si es onboarding_e1_instructions (correo E1), consultar y adjuntar dinámicamente los archivos de la carpeta E1
    if (emailType === 'onboarding_e1_instructions' || emailType === 'onboarding_e1') {
      try {
        const { data: e1Docs, error: e1Err } = await supabaseClient
          .from('service_docs')
          .select('name, file_url')
          .in('folder', ['E1', 'E1_General', 'E1_Onboarding', 'ONBOARDING_E1']);

        if (!e1Err && e1Docs && e1Docs.length > 0) {
          console.log(`[send-billing-email] Encontrados ${e1Docs.length} documentos en la carpeta E1.`);
          for (const doc of e1Docs) {
            try {
              console.log(`[send-billing-email] Descargando adjunto E1: ${doc.name} desde ${doc.file_url}`);
              const fileRes = await fetch(doc.file_url);
              if (fileRes.ok) {
                const arrayBuffer = await fileRes.arrayBuffer();
                const sizeInMB = arrayBuffer.byteLength / (1024 * 1024);

                if (sizeInMB < 4.0) {
                  const uint8 = new Uint8Array(arrayBuffer);
                  const base64Content = btoa(new TextDecoder('latin1').decode(uint8));

                  if (!brevoPayload.attachment) {
                    brevoPayload.attachment = [];
                  }

                  let docName = doc.name;
                  if (!docName.toLowerCase().endsWith('.pdf') && doc.file_url.toLowerCase().endsWith('.pdf')) {
                    docName += '.pdf';
                  }

                  brevoPayload.attachment.push({
                    content: base64Content,
                    name: docName
                  });
                  console.log(`[send-billing-email] Adjunto E1 ${docName} cargado con éxito (${sizeInMB.toFixed(2)} MB).`);
                } else {
                  console.log(`[send-billing-email] Omitiendo adjunto físico por superar los 4MB (disponible por link): ${doc.name} (${sizeInMB.toFixed(2)} MB).`);
                }
              } else {
                console.warn(`[send-billing-email] Adjunto opcional E1 ${doc.name} no se pudo descargar: HTTP ${fileRes.status}`);
              }
            } catch (err) {
              console.error(`[send-billing-email] Error descargando adjunto E1 ${doc.name}:`, err);
            }
          }
        } else {
          console.log(`[send-billing-email] No se encontraron documentos en la carpeta E1 en la base de datos:`, e1Err);
        }
      } catch (dbErr) {
        console.error(`[send-billing-email] Error al consultar adjuntos E1:`, dbErr);
      }
    }

    // Para lead_info_fulfillment / lead_info_presentation, los documentos se entregan vía enlaces directos optimizados
    if (emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info') {
      console.log(`[send-billing-email] Correo de información comercial preparado con enlaces directos.`);
    }

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": brevoApiKey
      },
      body: JSON.stringify(brevoPayload)
    });

    if (!brevoRes.ok) {
      const brevoErrText = await brevoRes.text();
      console.error("Error respuesta de Brevo:", brevoErrText);
      return new Response(JSON.stringify({ error: `Error de Brevo API: ${brevoErrText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const brevoData = await brevoRes.json();

    // Si es lead_info_fulfillment, registrar en lead_info_email_logs y actualizar status de leads
    if (emailType === 'lead_info_fulfillment' || emailType === 'lead_info_presentation' || emailType === 'commercial_info') {
      try {
        const contactName = payload.contactName || payload.nombreContacto || payload.nombre_contacto || payload.nombre || payload.full_name || '';
        const commerceNameStr = commerceName || payload.commerceName || payload.empresa || '';
        const primaryRecipient = finalRecipients[0] || (recipientEmails && recipientEmails[0]) || '';
        const ccStr = typeof rawCc === 'string' ? rawCc : (Array.isArray(rawCc) ? rawCc.join(', ') : (typeof payload?.cc === 'string' ? payload.cc : ''));

        const { error: infoLogErr } = await supabaseClient
          .from('lead_info_email_logs')
          .insert([{
            recipient_email: primaryRecipient,
            contact_name: contactName,
            commerce_name: commerceNameStr,
            cc_emails: ccStr,
            subject: emailSubject,
            sent_by: user?.id || null,
            message_id: brevoData.messageId || null,
            status: 'delivered',
            notes: payload.notes || ''
          }]);

        if (infoLogErr) {
          console.error('[send-billing-email] Error registrando en lead_info_email_logs:', infoLogErr.message);
        } else {
          console.log('[send-billing-email] Registro en lead_info_email_logs guardado exitosamente.');
        }

        // Si el correo existe en profiles (lead demo), actualizar su status y log
        if (primaryRecipient) {
          try {
            const { data: matchedProfiles } = await supabaseClient
              .from('profiles')
              .select('id, lead_emails_sent, lead_status')
              .eq('email', primaryRecipient);

            if (matchedProfiles && matchedProfiles.length > 0) {
              for (const prof of matchedProfiles) {
                const existingSent = Array.isArray(prof.lead_emails_sent) ? prof.lead_emails_sent : [];
                const updatedSent = [...existingSent, {
                  type: 'INFO_COMERCIAL',
                  sent_at: new Date().toISOString(),
                  subject: emailSubject,
                  message_id: brevoData.messageId || null
                }];
                const newLeadStatus = (prof.lead_status === 'convertido' || prof.lead_status === 'onboarding' || prof.lead_status === 'e1_enviado') 
                  ? prof.lead_status 
                  : 'contactado';

                await supabaseClient
                  .from('profiles')
                  .update({
                    lead_emails_sent: updatedSent,
                    lead_status: newLeadStatus
                  })
                  .eq('id', prof.id);
              }
            }
          } catch (profUpdateErr) {
            console.warn('[send-billing-email] Aviso actualizando perfil demo para info comercial:', profUpdateErr);
          }

          // Si el correo existe en quote_leads, actualizar status a contactado
          try {
            await supabaseClient
              .from('quote_leads')
              .update({ status: 'contactado' })
              .eq('email', primaryRecipient)
              .or('status.eq.nuevo,status.is.null');
          } catch (quoteUpdateErr) {
            console.warn('[send-billing-email] Aviso actualizando quote_leads para info comercial:', quoteUpdateErr);
          }
        }
      } catch (logErr: any) {
        console.warn("[send-billing-email] Fallo al registrar en lead_info_email_logs:", logErr.message);
      }
    }

    // Si es onboarding_e1_instructions, registrar en e1_email_logs y actualizar status de leads
    if (emailType === 'onboarding_e1_instructions' || emailType === 'onboarding_e1') {
      try {
        const contactName = payload.contactName || payload.nombreContacto || payload.nombre_contacto || payload.nombre || payload.full_name || '';
        const commerceNameStr = commerceName || payload.commerceName || payload.empresa || '';
        const primaryRecipient = finalRecipients[0] || (recipientEmails && recipientEmails[0]) || '';
        const ccStr = typeof rawCc === 'string' ? rawCc : (Array.isArray(rawCc) ? rawCc.join(', ') : (typeof payload?.cc === 'string' ? payload.cc : ''));

        const { error: e1LogErr } = await supabaseClient
          .from('e1_email_logs')
          .insert([{
            recipient_email: primaryRecipient,
            contact_name: contactName,
            commerce_name: commerceNameStr,
            cc_emails: ccStr,
            sent_by: user?.id || null,
            message_id: brevoData.messageId || null,
            status: 'delivered'
          }]);

        if (e1LogErr) {
          console.error('[send-billing-email] Error registrando en e1_email_logs:', e1LogErr.message);
        } else {
          console.log('[send-billing-email] Registro en e1_email_logs guardado exitosamente.');
        }

        // Si el correo existe en profiles (lead demo), actualizar su status y log
        if (primaryRecipient) {
          try {
            const { data: matchedProfiles } = await supabaseClient
              .from('profiles')
              .select('id, lead_emails_sent, lead_status')
              .eq('email', primaryRecipient);

            if (matchedProfiles && matchedProfiles.length > 0) {
              for (const prof of matchedProfiles) {
                const existingSent = Array.isArray(prof.lead_emails_sent) ? prof.lead_emails_sent : [];
                const updatedSent = [...existingSent, {
                  type: 'E1',
                  sent_at: new Date().toISOString(),
                  message_id: brevoData.messageId || null
                }];
                const newLeadStatus = (prof.lead_status === 'convertido' || prof.lead_status === 'onboarding') 
                  ? prof.lead_status 
                  : 'e1_enviado';

                await supabaseClient
                  .from('profiles')
                  .update({
                    lead_emails_sent: updatedSent,
                    lead_status: newLeadStatus
                  })
                  .eq('id', prof.id);
              }
            }
          } catch (profUpdateErr) {
            console.warn('[send-billing-email] Aviso actualizando perfil demo para E1:', profUpdateErr);
          }

          // Si el correo existe en quote_leads, actualizar status a e1_enviado
          try {
            await supabaseClient
              .from('quote_leads')
              .update({ status: 'e1_enviado' })
              .eq('email', primaryRecipient)
              .neq('status', 'cerrado');
          } catch (quoteUpdateErr) {
            console.warn('[send-billing-email] Aviso actualizando quote_leads para E1:', quoteUpdateErr);
          }
        }
      } catch (logErr: any) {
        console.warn("[send-billing-email] Fallo al registrar en e1_email_logs:", logErr.message);
      }
    }

    // Registrar log de notificación en la base de datos si no es onboarding ni notificaciones internas de stock
    if (!useInfoSender && emailType !== 'onboarding_e1_instructions' && emailType !== 'onboarding_e1') {
      try {
        const { error: logErr } = await supabaseClient
          .from('billing_notification_logs')
          .insert([{
            record_id: record?.id || null,
            comercio: commerceName,
            periodo_nombre: periodName || 'General',
            email_type: emailType,
            sent_to: recipientEmails,
            message_id: brevoData.messageId || null,
            status: 'enviado'
          }]);
        if (logErr) {
          console.error("Error al insertar log de notificación:", logErr.message);
        } else {
          console.log("Log de notificación guardado para:", commerceName);
        }
      } catch (logErr: any) {
        console.warn("Fallo al registrar log de notificación:", logErr.message);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Correo enviado exitosamente', 
      recipients: finalRecipients,
      messageId: brevoData.messageId 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error("Error en Edge Function send-billing-email:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
