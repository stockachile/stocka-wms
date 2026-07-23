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
        // Map Brevo event names to user-friendly database status values
        let dbStatus = "enviado";
        if (eventName === "delivered") {
          dbStatus = "entregado";
        } else if (eventName === "opened" || eventName === "unique_opened") {
          dbStatus = "abierto";
        } else if (eventName === "clicks") {
          dbStatus = "clickeado";
        } else if (["invalid_email", "deferred", "hard_bounce", "soft_bounce", "blocked", "spam"].includes(eventName)) {
          dbStatus = "fallido";
        } else {
          dbStatus = eventName; // Fallback to raw event name
        }

        console.log(`Actualizando mensaje ${messageId} a estado: ${dbStatus}`);

        // Update logs in database
        const { error } = await supabase
          .from("billing_notification_logs")
          .update({ status: dbStatus })
          .eq("message_id", messageId);

        if (error) {
          console.error(`Error al actualizar estado en DB para messageId ${messageId}:`, error.message);
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
