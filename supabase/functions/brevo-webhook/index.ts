import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // CORS Preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      }
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    console.log("Recibido Webhook de Brevo:", JSON.stringify(payload));

    const events = Array.isArray(payload) ? payload : [payload];

    for (const evt of events) {
      const eventName = evt.event; // 'request', 'delivered', 'opened', 'clicks', 'unique_opened', 'invalid_email', etc.
      const messageId = evt["message-id"];

      if (messageId && eventName) {
        let dbStatus = "enviado";
        const isOpened = eventName === "opened" || eventName === "unique_opened" || eventName === "loadedByProxy";
        const isClicked = eventName === "clicks";

        if (eventName === "delivered") {
          dbStatus = "entregado";
        } else if (isOpened) {
          dbStatus = "abierto";
        } else if (isClicked) {
          dbStatus = "clickeado";
        } else if (["invalid_email", "deferred", "hard_bounce", "soft_bounce", "blocked", "spam"].includes(eventName)) {
          dbStatus = "fallido";
        } else {
          dbStatus = eventName;
        }

        const eventDate = evt.date ? new Date(evt.date).toISOString() : new Date().toISOString();
        const clickedLink = evt.link || null;
        const recipientEmail = (evt.email || "").toLowerCase().trim();

        console.log(`[brevo-webhook] Evento ${eventName} (${dbStatus}) para ${recipientEmail}, messageId: ${messageId}`);

        // 1. Actualizar lead_info_email_logs
        try {
          const updatePayload: any = { status: dbStatus };
          if (isOpened) updatePayload.opened_at = eventDate;
          if (isClicked) {
            updatePayload.clicked_at = eventDate;
            if (clickedLink) updatePayload.notes = `Clic en enlace: ${clickedLink}`;
          }

          if (messageId) {
            await supabase.from("lead_info_email_logs").update(updatePayload).eq("message_id", messageId);
          }
          if (recipientEmail) {
            await supabase.from("lead_info_email_logs").update(updatePayload).ilike("recipient_email", recipientEmail);
          }
        } catch (e1Err: any) {
          console.warn("[brevo-webhook] Aviso actualizando lead_info_email_logs:", e1Err.message);
        }

        // 2. Actualizar e1_email_logs
        try {
          const updatePayload: any = { status: dbStatus };
          if (isOpened) updatePayload.opened_at = eventDate;
          if (isClicked) updatePayload.clicked_at = eventDate;

          if (messageId) {
            await supabase.from("e1_email_logs").update(updatePayload).eq("message_id", messageId);
          }
          if (recipientEmail) {
            await supabase.from("e1_email_logs").update(updatePayload).ilike("recipient_email", recipientEmail);
          }
        } catch (e2Err: any) {
          console.warn("[brevo-webhook] Aviso actualizando e1_email_logs:", e2Err.message);
        }

        // 3. Actualizar billing_notification_logs
        try {
          if (messageId) {
            await supabase.from("billing_notification_logs").update({ status: dbStatus }).eq("message_id", messageId);
          }
        } catch (billErr: any) {
          console.warn("[brevo-webhook] Aviso actualizando billing_notification_logs:", billErr.message);
        }

        // 4. Actualizar profiles (lead_emails_sent)
        if (recipientEmail) {
          try {
            const { data: matchedProfiles } = await supabase.from("profiles").select("id, lead_emails_sent").ilike("email", recipientEmail);
            if (matchedProfiles && matchedProfiles.length > 0) {
              for (const prof of matchedProfiles) {
                const history = Array.isArray(prof.lead_emails_sent) ? [...prof.lead_emails_sent] : [];
                let modified = false;
                history.forEach((h: any) => {
                  if (!h.status || h.status === "enviado" || h.status === "delivered" || isOpened || isClicked) {
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
                  await supabase.from("profiles").update({ lead_emails_sent: history }).eq("id", prof.id);
                }
              }
            }
          } catch (profErr: any) {
            console.warn("[brevo-webhook] Aviso actualizando profiles:", profErr.message);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err: any) {
    console.error("Error procesando webhook de Brevo:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
});
