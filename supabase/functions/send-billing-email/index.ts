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
    const KNOWN_SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8"

    const actualServiceKey = cleanServiceKey.startsWith("eyJ") ? cleanServiceKey : KNOWN_SERVICE_ROLE

    const supabaseClient = createClient(supabaseUrl, actualServiceKey, {
      auth: { persistSession: false }
    })

    console.log("--- AUTH DEBUG ---");
    console.log("Token length:", token.length);
    console.log("ServiceKey length:", cleanServiceKey.length);
    console.log("ActualServiceKey length:", actualServiceKey.length);
    console.log("Token starts with:", token.substring(0, 20));
    console.log("ServiceKey starts with:", cleanServiceKey.substring(0, 20));

    // Validar autorización
    let isAuthorized = false;
    let user = null;

    if (token === cleanServiceKey || token === KNOWN_SERVICE_ROLE || token === actualServiceKey) {
      console.log("Auth Status: Service Role Key Matched.");
      isAuthorized = true;
    } else {
      console.log("Auth Status: Trying User JWT Verification...");
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
        error: 'Unauthorized: Admins or triggers only',
        debug: {
          tokenLength: token.length,
          serviceKeyLength: cleanServiceKey.length,
          tokenStart: token.substring(0, 20),
          serviceKeyStart: cleanServiceKey.substring(0, 20),
          isEnvKeyEmpty: cleanServiceKey === ''
        }
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { recordId, serviceType, emails, customMessage, emailType = 'billing_summary', commerceName: payloadCommerceName } = await req.json()

    // Cargar registro de facturación si se suministra, o buscar el más reciente si solo tenemos commerceName
    let record = null;
    if (recordId) {
      const { data } = await supabaseClient
        .from('billing_records')
        .select('*, billing_periods(name)')
        .eq('id', recordId)
        .maybeSingle()
      record = data;
    } else if (payloadCommerceName) {
      const { data } = await supabaseClient
        .from('billing_records')
        .select('*, billing_periods(name)')
        .eq('comercio', payloadCommerceName)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      record = data;
    }

    const commerceName = record?.comercio || payloadCommerceName;

    if (!commerceName) {
      return new Response(JSON.stringify({ error: 'Falta parámetro recordId o commerceName' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const periodName = record?.billing_periods?.name || 'Periodo Actual';

    // Obtener los contactos de facturación activos para este comercio
    const { data: contacts, error: contactsErr } = await supabaseClient
      .from('billing_contacts')
      .select('email, nombre')
      .eq('comercio', commerceName)
      .eq('activo', true)

    if (contactsErr) {
      return new Response(JSON.stringify({ error: 'Error al obtener contactos de facturación: ' + contactsErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!contacts || contacts.length === 0) {
      if (!Array.isArray(emails) || emails.length === 0) {
        return new Response(JSON.stringify({ error: 'No existen contactos de facturación activos para ' + commerceName }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    const validEmails = (contacts || []).map(c => c.email.toLowerCase().trim())
    const recipientEmails: string[] = []

    if (Array.isArray(emails) && emails.length > 0) {
      emails.forEach((email: string) => {
        const cleaned = email.toLowerCase().trim()
        if (validEmails.includes(cleaned) || (cleaned.includes('@') && cleaned.includes('.'))) {
          recipientEmails.push(cleaned)
        }
      })
    } else {
      recipientEmails.push(...validEmails)
    }

    if (recipientEmails.length === 0) {
      return new Response(JSON.stringify({ error: 'Ninguno de los correos suministrados es un contacto activo válido para el comercio.' }), {
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
      const docLink = record.fulfillment_pdf_url || record.fulfillment_link;
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
        enviameDocsHtml = record.enviame_pdfs.map((pdf: any, idx: number) => {
          const url = typeof pdf === 'string' ? pdf : (pdf.url || '');
          const label = typeof pdf === 'string' ? `Descargar PDF Envíame ${idx + 1}` : (pdf.name || `Descargar PDF Envíame ${idx + 1}`);
          if (!url) return '';
          return `<a href="${url}" target="_blank" style="display: inline-block; background-color: #ffffff !important; color: #2563eb !important; border: 1px solid #2563eb; padding: 8px 16px; font-size: 13px; font-weight: 600; border-radius: 6px; text-decoration: none; margin: 5px;">${label}</a>`;
        }).filter((html: string) => html !== '').join(' ');
      } else {
        enviameDocsHtml = '<span style="color:#ef4444; font-size:12px; font-weight:600;">Desglose PDF no adjuntado aún</span>';
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
      emailSubject = `[URGENTE] Plazo de pago vencido - ${commerceName}`;
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
      emailSubject = `[AVISO] Plazo de pago vencido - ${commerceName}`;
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
      emailSubject = `[ALERTA CRÍTICA] Aviso de suspensión de servicio - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #dc2626, #991b1b)';
      emailTitle = 'Aviso de Suspensión de Servicio';

      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          Nos comunicamos para informarte que tu cuenta presenta un retraso crítico en el pago de los servicios pendientes de <strong>${periodName}</strong>.
        </div>

        <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #991b1b; line-height: 1.5; font-weight: 600;">
          ¡ATENCIÓN! De no regularizarse tu saldo a la brevedad, tu servicio de WMS y despachos será pausado temporalmente en los próximos días.
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
          <strong>Acción Requerida:</strong><br>
          Por favor, sube tu comprobante de pago a través de la plataforma WMS o ponte en contacto directo con nuestro departamento de finanzas en <a href="mailto:finanzas@stocka.cl" style="color:#b45309; font-weight:600;">finanzas@stocka.cl</a> para coordinar y evitar la pausa de tus operaciones.
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
          invoiceButtonsHtml += `<a href="${record.factura_fulfillment_pdf_url}" target="_blank" style="display: inline-block; background-color: #2563eb !important; color: #ffffff !important; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; margin: 5px;">Descargar Factura Fulfillment</a>`;
        }
        if (record.factura_enviame_pdf_url) {
          invoiceButtonsHtml += `<a href="${record.factura_enviame_pdf_url}" target="_blank" style="display: inline-block; background-color: #2563eb !important; color: #ffffff !important; padding: 10px 20px; font-size: 14px; font-weight: 600; border-radius: 8px; text-decoration: none; margin: 5px;">Descargar Factura Envíame</a>`;
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
      emailSubject = `Hemos recibido tu solicitud de alta - ${commerceName}`;
      headerGradient = 'linear-gradient(135deg, #4f46e5, #3b82f6)';
      emailTitle = 'Solicitud de Alta Recibida';
      
      emailBodyHtml = `
        <div style="font-size: 16px; color: #1e293b; margin-bottom: 20px; line-height: 1.5;">
          Estimado equipo de <strong>${commerceName}</strong>,<br><br>
          ¡Gracias por completar tu proceso de onboarding! Hemos recibido con éxito tus datos comerciales y el contrato firmado.
        </div>
        
        <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 15px; margin-bottom: 20px; font-size: 14px; color: #1e40af; line-height: 1.5;">
          <strong>Estado:</strong> En Revisión Comercial<br>
          Nuestro equipo revisará los documentos adjuntos y configurará los parámetros de tu comercio. Te notificaremos por correo electrónico en un plazo estimado de 24 a 48 horas hábiles.
        </div>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          Durante este periodo, si necesitas realizar alguna modificación o tienes dudas, puedes responder directamente a este correo.
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
        
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin-bottom: 20px; font-size: 14.5px; color: #166534; line-height: 1.5; font-weight: 600; text-align: center;">
          CUENTA ACTIVA Y OPERATIVA
        </div>
        
        <div style="font-size: 13.5px; color: #475569; line-height: 1.6; margin-bottom: 20px;">
          Tu comercio ha sido configurado en el WMS de Stocka. A partir de ahora puedes acceder con tus credenciales de usuario registradas y utilizar todas las funcionalidades:
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>Cargar y gestionar tu catálogo de productos.</li>
            <li>Crear declaraciones de ingreso de stock a bodega.</li>
            <li>Conectar tus integraciones de Shopify, WooCommerce u otras plataformas.</li>
          </ul>
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
    else {
      if (resolvedServiceType === 'fulfillment') {
        emailSubject = `[Facturación] Desglose de servicios Fulfillment ${periodName} - ${commerceName}`;
      } else if (resolvedServiceType === 'enviame') {
        emailSubject = `[Facturación] Desglose de despachos Enviame ${periodName} - ${commerceName}`;
      } else {
        emailSubject = `[Facturación] Desglose de servicios Fulfillment y Envíame ${periodName} - ${commerceName}`;
      }
      headerGradient = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
      emailTitle = 'Resumen de Facturación';

      emailBodyHtml = `
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

    const htmlBody = `
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

    const isOnboarding = ['onboarding_received', 'onboarding_approved', 'onboarding_observed'].includes(emailType);
    const brevoPayload = {
      sender: {
        name: isOnboarding ? "Stocka" : "Finanzas Stocka",
        email: isOnboarding ? "info@stocka.cl" : "finanzas@stocka.cl"
      },
      to: recipientEmails.map(email => ({ email })),
      subject: emailSubject,
      htmlContent: htmlBody
    };

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

    // Registrar log de notificación en la base de datos si no es onboarding
    if (!isOnboarding) {
      try {
        const { error: logErr } = await supabaseClient
          .from('billing_notification_logs')
          .insert([{
            record_id: record?.id || null,
            comercio: commerceName,
            periodo_nombre: periodName || 'General',
            email_type: emailType,
            sent_to: recipientEmails
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
      recipients: recipientEmails,
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
