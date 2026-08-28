import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const rawBrevoKey = Deno.env.get('BREVO_API_KEY') ?? ''
    const FALLBACK_BREVO_KEY = 'YOUR_BREVO_API_KEY_HERE'
    const brevoApiKey = (rawBrevoKey.trim().startsWith('xkeysib') ? rawBrevoKey : FALLBACK_BREVO_KEY).trim()

    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const cleanServiceKey = supabaseServiceKey.trim()
    const KNOWN_SERVICE_ROLE = "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE"
    const actualServiceKey = cleanServiceKey.startsWith("eyJ") ? cleanServiceKey : KNOWN_SERVICE_ROLE

    const supabaseClient = createClient(supabaseUrl, actualServiceKey, {
      auth: { persistSession: false }
    })

    const payload = await req.json()

    const contactName = (payload.contactName || payload.name || payload.nombre || '').trim()
    const email = (payload.email || payload.correo || '').trim().toLowerCase()
    const phone = (payload.phone || payload.telefono || '').trim()
    const companyName = (payload.companyName || payload.company || payload.tienda || payload.comercio || '').trim()
    const website = (payload.website || payload.web || payload.instagram || '').trim()
    const services = payload.services || payload.servicios || []
    const monthlyVolume = (payload.monthlyVolume || payload.volume || payload.volumen || '').trim()
    const storageSpace = (payload.storageSpace || payload.storage || payload.almacenamiento || '').trim()
    const notes = (payload.notes || payload.message || payload.mensaje || '').trim()

    if (!email) {
      return new Response(JSON.stringify({ error: 'El correo electrónico es requerido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const servicesText = Array.isArray(services) ? services.join(', ') : String(services || 'Fulfillment 360')
    const cleanPhoneForWa = phone.replace(/\D/g, '')
    const waLink = cleanPhoneForWa ? `https://wa.me/${cleanPhoneForWa.startsWith('56') ? cleanPhoneForWa : '56' + cleanPhoneForWa}` : null

    // 1. Guardar o actualizar en quote_leads
    const leadRecord = {
      email: email,
      contact_name: contactName || 'Contacto Web',
      company_name: companyName || 'Tienda Ecommerce',
      phone: phone || null,
      notes: `Servicios: ${servicesText}\nVolumen mensual: ${monthlyVolume || 'No especificado'}\nEspacio m3: ${storageSpace || 'No especificado'}\nWeb/IG: ${website || 'No indicado'}\nComentarios: ${notes || 'Sin comentarios adicionales'}`,
      status: 'nuevo',
      created_at: new Date().toISOString()
    }

    try {
      const { error: insErr } = await supabaseClient.from('quote_leads').insert([leadRecord])
      if (insErr) {
        console.warn('Aviso insertando en quote_leads:', insErr.message)
      }
    } catch (e) {
      console.warn('Excepción guardando lead en Supabase:', e)
    }

    // 2. Enviar aviso de nuevo lead al equipo de Stocka (exclusivamente a stockachile@gmail.com)
    if (brevoApiKey) {
      const stockaNotificationHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a; margin: 0; padding: 20px; }
    .card { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: linear-gradient(135deg, #0f172a, #1e293b); color: #ffffff; padding: 24px 20px; text-align: center; }
    .body { padding: 24px 20px; }
    .field-row { margin-bottom: 12px; font-size: 14px; line-height: 1.5; }
    .label { font-weight: 700; color: #475569; display: inline-block; width: 140px; }
    .val { color: #0f172a; font-weight: 600; }
    .badge { display: inline-block; background: #e0e7ff; color: #4338ca; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; }
    .notes-box { background: #f1f5f9; border-left: 4px solid #5e17eb; padding: 12px 14px; border-radius: 6px; font-size: 13.5px; color: #334155; margin-top: 15px; }
    .btn-wa { display: inline-block; background: #25d366; color: #ffffff !important; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; font-size: 13.5px; margin-top: 15px; }
    .btn-mail { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; font-size: 13.5px; margin-top: 15px; margin-left: 8px; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #38bdf8; font-weight: 700; margin-bottom: 4px;">Formulario Web stocka.cl</div>
      <h2 style="margin: 0; font-size: 20px; color: #ffffff;">🚀 Nuevo Lead de Fulfillment</h2>
    </div>
    <div class="body">
      <div class="field-row"><span class="label">Tienda / Comercio:</span> <span class="val" style="font-size: 16px; color: #5e17eb;">${companyName || 'No especificado'}</span></div>
      <div class="field-row"><span class="label">Contacto:</span> <span class="val">${contactName || 'No especificado'}</span></div>
      <div class="field-row"><span class="label">Correo:</span> <a href="mailto:${email}" style="color: #2563eb; font-weight: 600;">${email}</a></div>
      <div class="field-row"><span class="label">Teléfono:</span> <span class="val">${phone || 'No indicado'}</span></div>
      ${website ? `<div class="field-row"><span class="label">Sitio Web / IG:</span> <a href="${website.startsWith('http') ? website : 'https://' + website}" target="_blank" style="color: #2563eb;">${website}</a></div>` : ''}
      <div class="field-row"><span class="label">Ventas Mensuales:</span> <span class="badge">${monthlyVolume || 'No especificado'}</span></div>
      <div class="field-row"><span class="label">Espacio Estimado:</span> <span class="badge" style="background: #ecfdf5; color: #065f46;">${storageSpace || 'No especificado'}</span></div>
      <div class="field-row"><span class="label">Servicios de interés:</span> <span class="val">${servicesText}</span></div>
      
      ${notes ? `
        <div class="notes-box">
          <strong>Mensaje del comercio:</strong><br>
          ${notes.replace(/\n/g, '<br>')}
        </div>
      ` : ''}

      <div style="margin-top: 20px; text-align: center;">
        ${waLink ? `<a href="${waLink}" class="btn-wa" target="_blank">💬 Chatear por WhatsApp</a>` : ''}
        <a href="mailto:${email}?subject=Propuesta%20Fulfillment%20Stocka%20-%20${encodeURIComponent(companyName || '')}" class="btn-mail">✉️ Responder por Correo</a>
      </div>
    </div>
    <div class="footer">
      STOCKA SpA • Lead Engine • ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}
    </div>
  </div>
</body>
</html>
      `

      try {
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": brevoApiKey
          },
          body: JSON.stringify({
            sender: { name: "Stocka Web Leads", email: "contacto@stocka.cl" },
            to: [{ email: "stockachile@gmail.com", name: "Equipo Stocka" }],
            subject: `🚀 Nuevo Lead: ${companyName || 'Comercio'} (${contactName || 'Web'}) - stocka.cl`,
            htmlContent: stockaNotificationHtml
          })
        })
        console.log(`[submit-lead] Notificación enviada exitosamente a stockachile@gmail.com`);
      } catch (adminMailErr) {
        console.error('[submit-lead] Error enviando correo al equipo Stocka:', adminMailErr)
      }

      // 3. Enviar correo de Presentación Comercial Oficial al Prospecto (Lead)
      const contactGreeting = contactName ? `¡Hola, ${contactName}! 👋` : `¡Hola! 👋`
      const displayCommerce = companyName ? ` - ${companyName}` : ''
      const clientEmailSubject = `Información y Propuesta Fulfillment 360 - Stocka${displayCommerce}`

      // URLs por defecto
      let fulfillmentDocUrl = 'https://ejtjfaucnxbikrwjwwdu.supabase.co/storage/v1/object/public/service_docs/presentations/presentacion_fulfillment_360_1787715943297.pdf'
      let despachosDocUrl = 'https://ejtjfaucnxbikrwjwwdu.supabase.co/storage/v1/object/public/service_docs/presentations/presentacion_despachos_rm_1787715973435.pdf'
      let courierFolderUrl = 'https://docs.google.com/spreadsheets/d/1WlGXFbtgc3v-opuld8sqrSnpmQ1LGPvKWWRyRg5zGVs/edit?gid=0#gid=0'
      let cotizadorUrl = 'https://wms.stocka.cl/cotizaciones.html'
      let meetingUrl = 'https://meetings.hubspot.com/stocka?uuid=929cb56a-bc62-4d02-95c4-6005a47768a5'

      // Consultar dinámicamente pricing_config para que cualquier cambio futuro en el Admin aplique automáticamente
      try {
        const { data: pConfigData } = await supabaseClient
          .from('pricing_config')
          .select('data')
          .eq('config_key', 'current_rates')
          .maybeSingle()

        if (pConfigData?.data?.presentations) {
          const pres = pConfigData.data.presentations
          if (pres.fulfillment_url) fulfillmentDocUrl = pres.fulfillment_url
          if (pres.despachos_rm_url) despachosDocUrl = pres.despachos_rm_url
          if (pres.courier_folder_url) courierFolderUrl = pres.courier_folder_url
          if (pres.cotizador_url) cotizadorUrl = pres.cotizador_url
          if (pres.meeting_url) meetingUrl = pres.meeting_url
          console.log('[submit-lead] Presentaciones dinámicas cargadas desde pricing_config')
        }
      } catch (e) {
        console.warn('[submit-lead] Aviso cargando pricing_config:', e)
      }

      const leadEmailHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${clientEmailSubject}</title>
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
    .btn-meeting { display: block; background: #5e17eb; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(94,23,235,0.3); }
    .btn-wa { display: block; background: #25d366; color: #ffffff !important; text-decoration: none; text-align: center; padding: 12px 20px; border-radius: 8px; font-weight: 700; font-size: 14px; }
    .email-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 25px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="email-container" style="max-width: 650px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    
    <!-- HEADER CORPORATIVO -->
    <div style="background: #0f172a; padding: 30px 25px; text-align: center; color: #ffffff;">
      <img src="https://cdn.shopify.com/s/files/1/0625/6141/9483/files/Stocka_1300_x_500_px_519_x_200_px_5.png?v=1779650350" alt="STOCKA Logo" style="height: 42px; margin-bottom: 12px; display: inline-block;">
      <h1 style="font-size: 20px; font-weight: 700; margin: 0; color: #ffffff; letter-spacing: 0.5px;">Propuesta y Servicios Fulfillment 360</h1>
      <div style="font-size: 13px; color: #94a3b8; margin-top: 5px;">Soluciones Integrales de Almacenamiento, Preparación y Despacho para Ecommerce</div>
    </div>

    <!-- BODY -->
    <div style="padding: 30px 25px;">
      <div style="font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">${contactGreeting}</div>
      
      <p style="font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 18px;">
        Muchas gracias por tu interés en los servicios de <strong>Fulfillment 360 de STOCKA</strong>. Te escribe <strong>Felipe Trujillo</strong>, Socio Fundador de <a href="https://stocka.cl" target="_blank" style="color: #5e17eb; font-weight: 700; text-decoration: underline;">Stocka.cl</a>.
        <br><br>
        En Stocka somos un partner logístico especializado en potenciar marcas online mediante un modelo de servicio <strong>integral, ágil y 100% escalable</strong>, diseñado para que puedas delegar la logística y concentrarte en el crecimiento de tus ventas:
      </p>

      <!-- 4 PILARES CLAVE -->
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

      <!-- RECURSOS Y DOCUMENTOS OFICIALES (ENLACES DIRECTOS) -->
      <div style="margin: 22px 0 20px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 6px;">
          📚 Recursos y Documentos Oficiales en Línea:
        </div>
        <p style="font-size: 12px; color: #64748b; margin: 0 0 14px 0; line-height: 1.4;">
          Accede directamente a la información y presentaciones de servicios haciendo clic en los siguientes enlaces:
        </p>
        <div style="display: table; width: 100%; margin-bottom: 8px;">
          <div style="display: table-cell; width: 50%; padding-right: 5px;">
            <a href="${fulfillmentDocUrl}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              📦 <span style="color: #5e17eb;">Presentación Fulfillment 360</span> (PDF) ↗
            </a>
          </div>
          <div style="display: table-cell; width: 50%; padding-left: 5px;">
            <a href="${despachosDocUrl}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
              🚚 <span style="color: #2563eb;">Alternativas Despachos RM</span> (PDF) ↗
            </a>
          </div>
        </div>
        <a href="${courierFolderUrl}" target="_blank" style="display: block; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 10px; text-decoration: none; color: #0f172a; font-size: 12px; font-weight: 700; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
          🌐 <span style="color: #7c3aed;">Planilla Tarifas Courier Chile (Google Sheets)</span> ↗
        </a>
      </div>

      <!-- CAJA COTIZADOR -->
      <div style="margin: 20px 0; background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 10px; padding: 18px 20px; text-align: center;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 4px;">
          🧮 ¿Quieres simular tu cotización en menos de 1 minuto?
        </div>
        <p style="font-size: 12.5px; color: #64748b; margin: 0 0 14px 0;">
          Ingresa tus estimaciones de pedidos mensuales y volumen para obtener un desglose inmediato:
        </p>
        <a href="${cotizadorUrl}" target="_blank" style="display: inline-block; background: #ffffff; color: #5e17eb !important; border: 1.5px solid #5e17eb; text-decoration: none; padding: 10px 22px; border-radius: 8px; font-weight: 700; font-size: 13.5px; box-shadow: 0 2px 6px rgba(94, 23, 235, 0.08);">
          🔄 Simular Cotización Online en Cotizador WMS ↗
        </a>
      </div>

      <!-- AGENDAMIENTO REUNIÓN VIRTUAL -->
      <div style="margin: 25px 0 20px 0; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 22px 20px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); border-left: 4px solid #5e17eb;">
        <div style="margin-bottom: 8px;">
          <span style="display: inline-block; font-size: 11px; font-weight: 700; color: #5e17eb; background: rgba(94, 23, 235, 0.08); padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(94, 23, 235, 0.2); margin-right: 8px;">
            ⏱ 20–30 min.
          </span>
          <span style="font-size: 12px; color: #64748b; font-weight: 600;">
            📹 Reunión 1 a 1 vía Google Meet
          </span>
        </div>

        <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">
          Agenda una reunión para conocernos mejor
        </div>
        
        <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0; line-height: 1.5;">
          Te recomendamos revisar nuestra presentación de servicios, así podremos conversar con mayor profundidad en lo que necesita tu negocio.
        </p>

        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
          <img src="https://wms.stocka.cl/images/felipe_avatar.png" alt="Felipe de Stocka.cl" width="44" height="44" style="border-radius: 50%; border: 2px solid #5e17eb; display: block;">
          <div>
            <div style="font-size: 14px; font-weight: 700; color: #0f172a;">Felipe Trujillo</div>
            <div style="font-size: 12px; color: #64748b;">Socio Fundador / Asesoría Comercial Stocka</div>
          </div>
        </div>

        <a href="${meetingUrl}" target="_blank" class="btn-meeting" style="display: block; background: #5e17eb; color: #ffffff !important; text-decoration: none; text-align: center; padding: 14px 20px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 12px rgba(94,23,235,0.3);">
          👉 Programar una reunión vía Meet ↗
        </a>
      </div>

      <!-- WHATSAPP DIRECTO -->
      <a href="https://wa.me/56939247487" target="_blank" class="btn-wa" style="display: block; background: #25d366; color: #ffffff !important; text-decoration: none; text-align: center; padding: 12px 20px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 12px;">
        💬 Coordinar Asesoría Comercial por WhatsApp (+56 9 3924 7487)
      </a>

    </div>

    <!-- FOOTER -->
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 25px; text-align: center; font-size: 12px; color: #64748b; line-height: 1.5;">
      <strong>STOCKA SpA</strong> • Soluciones Integrales de Fulfillment y Bodegaje en Chile<br>
      Sitio web: <a href="https://stocka.cl" style="color: #5e17eb; text-decoration: none; font-weight: 600;">stocka.cl</a> • Portal WMS: <a href="https://wms.stocka.cl" style="color: #5e17eb; text-decoration: none; font-weight: 600;">wms.stocka.cl</a><br>
      Email: <a href="mailto:contacto@stocka.cl" style="color: #5e17eb; text-decoration: none; font-weight: 600;">contacto@stocka.cl</a> • WhatsApp: +56 9 3924 7487
    </div>

  </div>
</body>
</html>
      `

      // Payload sin archivos adjuntos pesados, 100% enfocado en enlaces directos
      const brevoLeadPayload: any = {
        sender: { name: "Felipe de Stocka", email: "contacto@stocka.cl" },
        to: [{ email: email, name: contactName || "Cliente" }],
        replyTo: { email: "contacto@stocka.cl", name: "Stocka Fulfillment" },
        subject: clientEmailSubject,
        htmlContent: leadEmailHtml
      }

      try {
        const leadSendRes = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": brevoApiKey
          },
          body: JSON.stringify(brevoLeadPayload)
        })
        if (leadSendRes.ok) {
          console.log(`[submit-lead] Correo de presentación enviado exitosamente a ${email}`)
          // Registrar en lead_info_email_logs
          try {
            await supabaseClient.from('lead_info_email_logs').insert([{
              recipient_email: email,
              contact_name: contactName,
              commerce_name: companyName,
              subject: clientEmailSubject,
              status: 'delivered',
              notes: 'Envío automático desde Formulario Web stocka.cl',
              sent_at: new Date().toISOString()
            }])
          } catch (e) {}
        } else {
          const leadErrText = await leadSendRes.text()
          console.error('[submit-lead] Error enviando correo al prospecto:', leadErrText)
        }
      } catch (leadMailErr) {
        console.error('[submit-lead] Excepción enviando correo al prospecto:', leadMailErr)
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Solicitud recibida exitosamente. Hemos enviado la presentación oficial a tu correo.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('[submit-lead] Error en ejecución:', error)
    return new Response(JSON.stringify({ error: error?.message || 'Error interno del servidor' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
