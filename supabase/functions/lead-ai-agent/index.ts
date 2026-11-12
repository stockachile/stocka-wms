import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STOCKA_SYSTEM_PROMPT = `Eres el Agente Comercial Senior de STOCKA SpA (stocka.cl / wms.stocka.cl), empresa chilena líder en Fulfillment 360 para Ecommerce.
Tu misión es analizar cada prospecto (lead) que ingresa a la Central de Leads, revisar su simulación del cotizador online, responder con precisión las consultas dejadas en el formulario y, si tuvo una reunión en Google Meet (agendada vía HubSpot), incorporar los acuerdos y notas generadas por Gemini en Meet para redactar una propuesta de seguimiento ganadora.

REGLAS COMERCIALES Y OPERATIVAS OFICIALES DE STOCKA (NO INVENTES TARIFAS FUERA DE ESTOS PARÁMETROS):
1. QUIÉNES SOMOS Y TONO:
   - Redactas en primera persona en nombre de Felipe Trujillo, Socio Fundador de Stocka ("Hola [Nombre]", tono cercano, ejecutivo, consultivo, chileno profesional: usa "tú", "tu tienda", "tu operación").
   - Nunca uses lenguaje robótico ni promesas irreales.

2. MODELO TARIFARIO FULFILLMENT 360:
   - Almacenamiento en Bodega: Se cobra proporcionalmente por los m³ realmente ocupados en bodega (según tramo de volumen mensual de pedidos). Sin contratos de amarre forzoso.
   - Pick & Pack (Preparación de pedidos): Incluye recepción operativa, control de calidad, picking, embalaje operativo y etiquetado (incluye hasta 3 SKUs y 10 unidades por pedido base).
   - EXENCIÓN DE CARGO BASE MENSUAL ($0):
     * Para operaciones en etapa inicial (< 75 pedidos/mes y < 1,5 m³), existe un cargo base mínimo mensual de servicio (0,9 UF + IVA).
     * Apenas el comercio alcanza 75 pedidos/mes O 1,5 m³ de almacenamiento en bodega, el Cargo Fijo Mensual queda 100% EXENTO ($0). ¡Este es uno de los argumentos comerciales más potentes para comercios en crecimiento!
   - Escalabilidad Automática: A medida que el comercio sube de tramo de pedidos (0-25, 26-100, 101-250, 251-500, 501+), disminuye automáticamente tanto el valor del Pick & Pack por pedido como el valor del m³ de bodega.

3. INTEGRACIONES Y TECNOLOGÍA WMS:
   - Integración Plug & Play SIN COSTO ADICIONAL con Shopify, WooCommerce, Jumpseller, Mercado Libre (incluyendo Mercado Envíos Flex), Falabella Seller Center, Paris y Ripley.
   - El cliente tiene acceso 24/7 al Portal WMS Stocka (wms.stocka.cl) para ver inventario en tiempo real, trazabilidad de cada pedido, recepciones de mercadería y facturación transparente.

4. DESPACHOS Y ÚLTIMA MILLA:
   - Same Day RM y Mercado Envíos Flex: Tarifa plana competitiva ($3.200 + IVA en toda la Región Metropolitana) con horarios de corte extendidos para entrega en el mismo día.
   - Regiones (Cobertura Nacional Multicourier): Operamos integrados con Starken, Blue Express y Envíame con tarifas corporativas preferenciales según peso y destino.

5. SERVICIOS PRESENCIALES EN SUCURSAL:
   - Retiro en Sucursal para compradores finales, Vitrina Showroom y Punto de Venta (POS) sincronizado al mismo inventario del WMS.

6. REUNIONES HUBSPOT Y NOTAS DE GEMINI EN GOOGLE MEET:
   - Si el prospecto tiene una reunión realizada y se incluyen las "Notas de Gemini en Google Meet" (meetGeminiNotes):
     * Analiza cuidadosamente el resumen, los dolores operativos conversados, los productos/SKUs mencionados y los compromisos adquiridos en la videollamada.
     * En el correo y en el WhatsApp agradece el tiempo en la reunión de Google Meet, haz un recap ejecutivo en viñetas de los acuerdos/puntos clave conversados en la reunión y presenta la propuesta / siguiente paso (como el alta en Paso E1 o ajuste de cotización).
   - Si el prospecto tiene una reunión agendada próxima (status = 'scheduled'):
     * Menciona que viste su reunión agendada, confirma disponibilidad y adelántale información útil para aprovechar al máximo esos minutos en Meet.

7. FORMATO DE SALIDA REQUERIDO:
   Debes responder SIEMPRE con un objeto JSON válido (sin bloques markdown \`\`\`json alrededor) con la siguiente estructura exacta:
   {
     "priorityLabel": "Etiqueta corta de prioridad con emoji (ej: 🎥 Post-Reunión Meet • Enviar Recap y Propuesta)",
     "aiInsight": "Diagnóstico ejecutivo de 2-3 líneas para Felipe explicando qué detectaste en este lead/reunión y por qué elegiste este ángulo.",
     "meetingSummary": {
       "executiveSummary": "Resumen de 2 líneas de lo conversado en Google Meet (vacío si no hay notas de reunión)",
       "painPoints": ["Dolor o necesidad 1 detectada en la reunión", "Dolor 2"],
       "agreements": ["Acuerdo o compromiso 1 de la reunión", "Acuerdo 2"],
       "nextSteps": "Siguiente paso concreto acordado"
     },
     "detectedTopics": [
       {
         "title": "Título breve del punto o consulta/acuerdo respondido",
         "answerHtml": "Respuesta en HTML breve usando <strong> para destacar conceptos clave."
       }
     ],
     "subject": "Asunto del correo persuasivo y personalizado",
     "customBoxTitle": "Título del bloque destacado dentro del correo (con un emoji al inicio)",
     "customHtml": "Cuerpo HTML del bloque personalizado del correo. Usa <p> para el párrafo inicial, luego un <ul> con 3 a 4 <li> (cada <li> con un <strong style=\\"color: #5e17eb;\\"> o <strong style=\\"color: #059669;\\"> al inicio) que respondan directamente a su consulta/reunión y expliquen su cotización/operación, y un <p> final invitando a conversar o avanzar. NO incluyas saludo inicial ('¡Hola!') ni firma de despedida porque la plantilla oficial ya los envuelve automáticamente.",
     "whatsappProposals": {
       "consultivo": "Mensaje completo de WhatsApp (usando *negritas* de WhatsApp y saltos de línea \\n\\n) cálido, consultivo, mencionando su tienda, su consulta o los acuerdos de la reunión en Meet.",
       "cotizacion": "Mensaje de WhatsApp enfocado en los números de su cotización, exención de costo fijo o acuerdos tarifarios.",
       "corto": "Mensaje corto y directo de WhatsApp (3-4 líneas) para iniciar conversación rápida o confirmar recepción post-Meet."
     }
   }`;

async function handleHubSpotSync(body: any) {
  const hubspotToken = (body.hubspotToken || Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "").trim();
  const googleMeetBridgeUrl = (body.googleMeetBridgeUrl || Deno.env.get("GOOGLE_MEET_BRIDGE_URL") || "").trim();

  const syncedMeetings: any[] = [];
  let hubspotStatus = "not_configured";
  let bridgeStatus = "not_configured";
  let hubspotError = "";

  // 1. Sincronizar desde HubSpot CRM API v3 (Meetings + Associated Contacts)
  if (hubspotToken) {
    try {
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/meetings/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${hubspotToken}`,
        },
        body: JSON.stringify({
          limit: 50,
          sorts: [{ propertyName: "hs_createdate", direction: "DESCENDING" }],
          properties: [
            "hs_meeting_title",
            "hs_meeting_body",
            "hs_internal_meeting_notes",
            "hs_meeting_external_url",
            "hs_meeting_start_time",
            "hs_meeting_end_time",
            "hs_meeting_outcome",
            "hs_timestamp",
            "hs_createdate"
          ]
        }),
      });

      if (!searchRes.ok) {
        const errTxt = await searchRes.text();
        hubspotError = `HubSpot API (${searchRes.status}): ${errTxt.substring(0, 220)}`;
        hubspotStatus = "error";
      } else {
        const searchData = await searchRes.json();
        const meetings = Array.isArray(searchData.results) ? searchData.results : [];
        hubspotStatus = "ok";

        for (const m of meetings) {
          const meetingId = String(m.id);
          const props = m.properties || {};

          // Obtener contactos asociados a esta reunión en HubSpot
          let contactEmail = "";
          let contactName = "";
          let companyName = "";
          let contactPhone = "";
          let contactId = "";

          try {
            const assocRes = await fetch(
              `https://api.hubapi.com/crm/v3/objects/meetings/${meetingId}/associations/contacts`,
              {
                headers: { "Authorization": `Bearer ${hubspotToken}` },
              }
            );
            if (assocRes.ok) {
              const assocData = await assocRes.json();
              const firstAssoc = assocData?.results?.[0];
              if (firstAssoc?.id) {
                contactId = String(firstAssoc.id);
                const cRes = await fetch(
                  `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}?properties=email,firstname,lastname,company,phone,mobilephone`,
                  {
                    headers: { "Authorization": `Bearer ${hubspotToken}` },
                  }
                );
                if (cRes.ok) {
                  const cData = await cRes.json();
                  const cp = cData?.properties || {};
                  contactEmail = (cp.email || "").trim().toLowerCase();
                  contactName = [cp.firstname, cp.lastname].filter(Boolean).join(" ").trim();
                  companyName = (cp.company || "").trim();
                  contactPhone = (cp.phone || cp.mobilephone || "").trim();
                }
              }
            }
          } catch (_assocErr) {
            // Ignorar error individual de asociación
          }

          // Intentar extraer email del body o título si no vino contacto asociado
          const rawBody = (props.hs_meeting_body || "").replace(/<[^>]+>/g, " ").trim();
          const rawInternalNotes = (props.hs_internal_meeting_notes || "").replace(/<[^>]+>/g, " ").trim();
          if (!contactEmail) {
            const emailMatch = `${rawBody} ${props.hs_meeting_title || ""}`.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) contactEmail = emailMatch[0].toLowerCase();
          }

          if (!contactEmail) continue;

          // Determinar estado normalizado
          const rawOutcome = (props.hs_meeting_outcome || "").toUpperCase();
          const startAt = props.hs_meeting_start_time || props.hs_timestamp || props.hs_createdate;
          const isPast = startAt ? new Date(startAt).getTime() < Date.now() - 30 * 60 * 1000 : false;

          let meetingStatus = "scheduled";
          if (rawOutcome === "COMPLETED") meetingStatus = "completed";
          else if (rawOutcome === "RESCHEDULED") meetingStatus = "rescheduled";
          else if (rawOutcome === "NO_SHOW") meetingStatus = "no_show";
          else if (rawOutcome === "CANCELED" || rawOutcome === "CANCELLED") meetingStatus = "canceled";
          else if (isPast) meetingStatus = "completed";

          // Extraer link de Google Meet si está en external_url o body
          let meetUrl = props.hs_meeting_external_url || "";
          if (!meetUrl) {
            const meetMatch = rawBody.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
            if (meetMatch) meetUrl = meetMatch[0];
          }

          syncedMeetings.push({
            hubspot_meeting_id: meetingId,
            hubspot_contact_id: contactId,
            lead_email: contactEmail,
            contact_name: contactName,
            company_name: companyName,
            phone: contactPhone,
            meeting_title: props.hs_meeting_title || "Reunión Comercial Stocka",
            meeting_start_at: startAt || new Date().toISOString(),
            meeting_end_at: props.hs_meeting_end_time || null,
            meeting_status: meetingStatus,
            meet_url: meetUrl,
            gemini_notes_raw: rawInternalNotes || "",
            meeting_body: rawBody,
          });
        }
      }
    } catch (err: any) {
      hubspotStatus = "error";
      hubspotError = err?.message || "Error conectando con HubSpot API";
    }
  }

  // 2. Si se configuró el puente de Google Calendar / Google Docs (Notas de Gemini Meet)
  if (googleMeetBridgeUrl) {
    try {
      const bridgeRes = await fetch(googleMeetBridgeUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });
      if (bridgeRes.ok) {
        const bridgeJson = await bridgeRes.json();
        const bridgeItems = Array.isArray(bridgeJson?.meetings) ? bridgeJson.meetings : (Array.isArray(bridgeJson) ? bridgeJson : []);
        bridgeStatus = "ok";

        for (const bm of bridgeItems) {
          const email = (bm.email || bm.lead_email || bm.attendeeEmail || "").trim().toLowerCase();
          if (!email) continue;

          const existing = syncedMeetings.find((sm) => sm.lead_email === email);
          if (existing) {
            if (bm.gemini_notes || bm.notes) existing.gemini_notes_raw = bm.gemini_notes || bm.notes;
            if (bm.gemini_doc_url || bm.docUrl) existing.gemini_doc_url = bm.gemini_doc_url || bm.docUrl;
            if (bm.meet_url || bm.hangoutLink) existing.meet_url = existing.meet_url || bm.meet_url || bm.hangoutLink;
            if (bm.status === "completed" || bm.gemini_notes || bm.notes) existing.meeting_status = "completed";
          } else {
            syncedMeetings.push({
              hubspot_meeting_id: bm.id || `gcal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              lead_email: email,
              contact_name: bm.contact_name || bm.attendeeName || "",
              company_name: bm.company_name || "",
              phone: bm.phone || "",
              meeting_title: bm.title || bm.meeting_title || "Reunión Google Meet - Stocka",
              meeting_start_at: bm.start_at || bm.startTime || new Date().toISOString(),
              meeting_end_at: bm.end_at || bm.endTime || null,
              meeting_status: bm.status || (bm.gemini_notes || bm.notes ? "completed" : "scheduled"),
              meet_url: bm.meet_url || bm.hangoutLink || "",
              gemini_doc_url: bm.gemini_doc_url || bm.docUrl || "",
              gemini_notes_raw: bm.gemini_notes || bm.notes || "",
            });
          }
        }
      } else {
        bridgeStatus = `error_${bridgeRes.status}`;
      }
    } catch (bErr: any) {
      bridgeStatus = `error: ${bErr?.message || "No disponible"}`;
    }
  }

  return new Response(
    JSON.stringify({
      success: hubspotStatus === "ok" || bridgeStatus === "ok",
      hubspotStatus,
      bridgeStatus,
      hubspotError,
      count: syncedMeetings.length,
      meetings: syncedMeetings,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Si es una acción de sincronización de reuniones HubSpot + Google Meet
    if (body.action === "sync_hubspot_meetings") {
      return await handleHubSpotSync(body);
    }

    const {
      lead = {},
      quoteSummary = {},
      clientQuestion = "",
      extraContext = "",
      strategy = "consultivo",
      meetingInfo = null,
      provider = "auto",
      apiKey = ""
    } = body;

    const geminiKey = (provider === "gemini" && apiKey) ? apiKey : (Deno.env.get("GEMINI_API_KEY") || apiKey || "");
    const openaiKey = (provider === "openai" && apiKey) ? apiKey : (Deno.env.get("OPENAI_API_KEY") || "");

    const meetingContextBlock = meetingInfo
      ? `
DATOS DE REUNIÓN (HUBSPOT MEETINGS / GOOGLE MEET):
- Estado de la Reunión: ${meetingInfo.meeting_status === "completed" ? "REALIZADA EN GOOGLE MEET" : meetingInfo.meeting_status === "scheduled" ? "AGENDADA PRÓXIMAMENTE" : meetingInfo.meeting_status}
- Fecha/Hora Reunión: ${meetingInfo.meeting_start_at || "No especificada"}
- Link Meet: ${meetingInfo.meet_url || "No especificado"}
- Pedidos/mes acordados o conversados en reunión: ${meetingInfo.agreed_monthly_orders || "Según simulación"}
- Volumen m³ acordado o conversado en reunión: ${meetingInfo.agreed_volume_m3 || "Según simulación"}
- NOTAS GENERADAS POR GEMINI EN GOOGLE MEET (Transcripción / Resumen / Acuerdos de la videollamada):
"""
${meetingInfo.gemini_notes_raw || "Sin notas de Gemini adjuntas aún."}
"""`
      : `\nDATOS DE REUNIÓN: Sin reunión registrada aún.`;

    const userPrompt = `Analiza el siguiente prospecto de la Central de Leads de STOCKA y genera la propuesta comercial en JSON:

DATOS DEL PROSPECTO:
- Nombre de Contacto: ${lead.name || "No especificado"}
- Empresa / Tienda: ${lead.company || "No especificada"}
- Email: ${lead.email || ""}
- Teléfono: ${lead.phone || "No registrado"}
- Web / Instagram: ${lead.website || "No indicado"}
- Orígenes del Lead: ${(lead.sources || []).join(", ")}
- Estado de lectura de correos previos (Brevo): ${lead.email_clicked ? "Hizo clic en documentos/links del correo" : (lead.email_read ? "Abrió y leyó el correo enviado" : "Aún no registra apertura o es primer contacto")}

SIMULACIÓN / COTIZACIÓN ONLINE:
- ¿Realizó simulación de cotización?: ${quoteSummary.hasQuoteSimulation ? "SÍ" : "NO (Solicitó información general)"}
- Pedidos mensuales estimados: ${quoteSummary.orders || 0} pedidos/mes
- Volumen de bodega estimado: ${quoteSummary.volumeM3 || 0} m³
- Envíos Same Day RM: ${quoteSummary.sameDayCount || 0} | Envíos Regiones: ${quoteSummary.courierCount || 0}
- Servicios extra en sucursal: POS=${quoteSummary.hasPos ? "Sí" : "No"}, Vitrina Showroom=${quoteSummary.hasVitrina ? "Sí" : "No"}
- Canales de venta: ${(quoteSummary.channels || []).join(", ") || "Por confirmar"}
- Tramo tarifario calculado: ${quoteSummary.activeRangeLabel || "Inicial"}
- Tarifa Pick & Pack unitaria: ${quoteSummary.pickPackUnitFormatted || "$1.200"} + IVA
- ¿Califica a Costo Fijo Mensual $0 (Exento >= 75 ped/mes o >= 1,5 m³)?: ${quoteSummary.isFixedExempt ? "SÍ, 100% Exento ($0)" : "Aún en etapa inicial (<75 ped y <1.5 m³, incluye cargo base de 0.9 UF, pero queda $0 apenas alcance 75 ped/mes o 1.5 m³)"}
- Costo Mensual Neto Estimado: ${quoteSummary.netMonthlyFormatted || "Por definir según volumen"} + IVA/mes (${quoteSummary.netMonthlyUF || "0"} UF)
${meetingContextBlock}

CONSULTA O COMENTARIO DEJADO POR EL PROSPECTO EN EL FORMULARIO:
"${clientQuestion || "No dejó preguntas abiertas en el campo de comentarios."}"

INSTRUCCIÓN ESPECÍFICA DEL EJECUTIVO (FELIPE):
"${extraContext || "Ninguna instrucción extra."}"

ESTRATEGIA SOLICITADA:
"${strategy}" (Opciones: 'consultivo' = Responder consultas y explicar cotización; 'seguimiento' = Seguimiento cercano para destrabar dudas; 'optimizacion' = Foco en ahorro, exención de fijo $0 y escalabilidad; 'cierre_reunion' = Invitar a reunión 1 a 1 en Meet o activar Onboarding Paso E1; 'post_reunion' = Recap de nuestra reunión en Google Meet, resumen de acuerdos tomados en las Notas de Gemini y propuesta final para avanzar).

Genera la respuesta exclusivamente en JSON válido siguiendo el esquema indicado.`;

    if ((provider === "gemini" || provider === "auto") && geminiKey) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: STOCKA_SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json"
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const parsed = JSON.parse(rawText);

      return new Response(
        JSON.stringify({
          success: true,
          provider: "gemini-2.5-flash",
          data: parsed
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if ((provider === "openai" || provider === "auto") && openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: STOCKA_SYSTEM_PROMPT },
            { role: "user", content: userPrompt }
          ]
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const rawText = data?.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(rawText);

      return new Response(
        JSON.stringify({
          success: true,
          provider: "gpt-4o-mini",
          data: parsed
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        reason: "no_api_key",
        message: "No se encontró GEMINI_API_KEY ni OPENAI_API_KEY configurada."
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[lead-ai-agent] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Error interno procesando el Agente IA"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
