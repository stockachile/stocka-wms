import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const brevoApiKey = Deno.env.get("BREVO_API_KEY") ?? "";

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-buyer-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSecureOtp6(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const num = 100000 + (arr[0] % 900000);
  return String(num);
}

function generateSessionTokenHex(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const clientIp = getClientIp(req);

    // =========================================================================
    // 1. SOLICITAR CÓDIGO OTP DE 6 DÍGITOS AL CORREO DEL COMPRADOR
    // =========================================================================
    if (action === "request_otp") {
      const rawEmail = String(body.email || "").trim().toLowerCase();
      const rawCommerceOrSlug = String(body.comercio_or_slug || body.comercio || "").trim();

      if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return new Response(JSON.stringify({ error: "Por favor ingresa un correo electrónico válido." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (!brevoApiKey) {
        return new Response(JSON.stringify({ error: "Servicio de correo temporalmente no disponible." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Resolver configuración e identidad visual del portal (Seller específico vs Stocka Global)
      const { data: portalCfg } = await supabase.rpc("get_public_return_portal_config", {
        p_comercio_or_slug: rawCommerceOrSlug || null
      });

      if (rawCommerceOrSlug && (!portalCfg || portalCfg.mode === "not_found" || portalCfg.is_enabled === false)) {
        return new Response(JSON.stringify({ error: "Este portal de cambios y devoluciones no se encuentra activo." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const scopeComercio: string | null = portalCfg?.mode === "seller" ? String(portalCfg.comercio) : null;
      const brandName = portalCfg?.brand_name || (scopeComercio ? scopeComercio : "Stocka Logistics");
      const primaryColor = /^#[0-9A-Fa-f]{6}$/.test(portalCfg?.primary_color || "")
        ? portalCfg.primary_color
        : "#5c24ff";
      const logoUrl = portalCfg?.logo_url || "";

      // Rate-limit: máx 4 solicitudes por email en 15 min y máx 12 por IP en 15 min
      const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count: emailCount } = await supabase
        .from("buyer_otp_challenges")
        .select("id", { count: "exact", head: true })
        .eq("email", rawEmail)
        .gte("created_at", windowStart);

      if ((emailCount || 0) >= 5) {
        return new Response(JSON.stringify({
          error: "Has solicitado demasiados códigos recientemente. Espera unos minutos o revisa tu carpeta de Spam."
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (clientIp && clientIp !== "unknown") {
        const { count: ipCount } = await supabase
          .from("buyer_otp_challenges")
          .select("id", { count: "exact", head: true })
          .eq("ip_address", clientIp)
          .gte("created_at", windowStart);

        if ((ipCount || 0) >= 15) {
          return new Response(JSON.stringify({
            error: "Demasiados intentos desde tu red. Por favor intenta nuevamente en 15 minutos."
          }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      }

      const otpCode = generateSecureOtp6();
      const otpHash = await sha256Hex(`${rawEmail}:${scopeComercio || "GLOBAL"}:${otpCode}`);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { error: insertErr } = await supabase.from("buyer_otp_challenges").insert([
        {
          email: rawEmail,
          scope_comercio: scopeComercio,
          otp_hash: otpHash,
          ip_address: clientIp,
          expires_at: expiresAt
        }
      ]);

      if (insertErr) {
        console.error("[reverse-portal-auth] Error creando desafío OTP:", insertErr);
        return new Response(JSON.stringify({ error: "No se pudo generar el código de seguridad." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const safeBrand = escapeHtml(brandName);
      const logoHtml = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="${safeBrand}" style="max-height: 48px; max-width: 200px; object-fit: contain; margin-bottom: 16px;">`
        : `<div style="font-size: 20px; font-weight: 800; color: ${primaryColor}; letter-spacing: -0.02em; margin-bottom: 12px;">${safeBrand}</div>`;

      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px;">
  <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);">
    <div style="height: 6px; background: ${primaryColor};"></div>
    <div style="padding: 32px 28px; text-align: center;">
      ${logoHtml}
      <h1 style="margin: 0 0 10px 0; font-size: 22px; font-weight: 800; color: #0f172a;">Código de Verificación</h1>
      <p style="margin: 0 0 24px 0; font-size: 14.5px; color: #475569; line-height: 1.55;">
        Ingresa el siguiente código de 6 dígitos para acceder a tus compras en <strong>${safeBrand}</strong> y gestionar cambios o devoluciones:
      </p>
      <div style="background: #f8fafc; border: 2px dashed ${primaryColor}; border-radius: 12px; padding: 18px 24px; margin: 0 auto 24px auto; display: inline-block;">
        <span style="font-family: 'Courier New', monospace; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0f172a;">${otpCode}</span>
      </div>
      <p style="margin: 0; font-size: 12.5px; color: #64748b; line-height: 1.5;">
        🔒 Este código es válido por <strong>10 minutos</strong>.<br>
        Si no solicitaste este acceso, puedes ignorar este mensaje con total tranquilidad.
      </p>
    </div>
    <div style="background: #f8fafc; padding: 14px 24px; text-align: center; font-size: 11.5px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
      Operado de forma segura por <strong>Stocka Logistics &amp; WMS</strong>
    </div>
  </div>
</body>
</html>`;

      const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "api-key": brevoApiKey
        },
        body: JSON.stringify({
          sender: { name: `${brandName} - Postventa`, email: "info@stocka.cl" },
          to: [{ email: rawEmail }],
          subject: `${otpCode} es tu código de acceso · ${brandName}`,
          htmlContent
        })
      });

      if (!brevoRes.ok) {
        const errTxt = await brevoRes.text();
        console.error("[reverse-portal-auth] Error Brevo:", errTxt);
        return new Response(JSON.stringify({ error: "No pudimos enviar el correo de verificación. Intenta nuevamente." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        expires_in_seconds: 600,
        scope_comercio: scopeComercio
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 2. VERIFICAR CÓDIGO OTP Y EMITIR TOKEN DE SESIÓN AISLADO
    // =========================================================================
    if (action === "verify_otp") {
      const rawEmail = String(body.email || "").trim().toLowerCase();
      const rawOtp = String(body.otp || "").replace(/\D/g, "").trim();
      const rawCommerceOrSlug = String(body.comercio_or_slug || body.comercio || "").trim();

      if (!rawEmail || rawOtp.length !== 6) {
        return new Response(JSON.stringify({ error: "Debes ingresar el correo y el código de 6 dígitos." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      let scopeComercio: string | null = null;
      if (rawCommerceOrSlug) {
        const { data: portalCfg } = await supabase.rpc("get_public_return_portal_config", {
          p_comercio_or_slug: rawCommerceOrSlug
        });
        if (portalCfg?.mode === "seller") {
          scopeComercio = String(portalCfg.comercio);
        }
      }

      let query = supabase
        .from("buyer_otp_challenges")
        .select("*")
        .eq("email", rawEmail)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      if (scopeComercio) {
        query = query.eq("scope_comercio", scopeComercio);
      } else {
        query = query.is("scope_comercio", null);
      }

      const { data: challenges } = await query;
      const challenge = challenges && challenges[0] ? challenges[0] : null;

      if (!challenge) {
        return new Response(JSON.stringify({
          error: "El código no es válido o ha expirado. Solicita un nuevo código."
        }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (challenge.attempts >= challenge.max_attempts) {
        return new Response(JSON.stringify({
          error: "Superaste el número máximo de intentos. Solicita un nuevo código."
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const expectedHash = await sha256Hex(`${rawEmail}:${scopeComercio || "GLOBAL"}:${rawOtp}`);
      if (expectedHash !== challenge.otp_hash) {
        await supabase
          .from("buyer_otp_challenges")
          .update({ attempts: (challenge.attempts || 0) + 1 })
          .eq("id", challenge.id);

        const remaining = Math.max(0, challenge.max_attempts - ((challenge.attempts || 0) + 1));
        return new Response(JSON.stringify({
          error: `Código incorrecto. Te quedan ${remaining} intento(s).`
        }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Marcar OTP consumido
      await supabase
        .from("buyer_otp_challenges")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", challenge.id);

      // Crear sesión válida por 2 horas
      const rawSessionToken = generateSessionTokenHex();
      const sessionTokenHash = await sha256Hex(rawSessionToken);
      const sessionExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      const { error: sessErr } = await supabase.from("buyer_portal_sessions").insert([
        {
          session_token_hash: sessionTokenHash,
          email: rawEmail,
          scope_comercio: scopeComercio,
          ip_address: clientIp,
          user_agent: (req.headers.get("user-agent") || "").slice(0, 250),
          expires_at: sessionExpiresAt
        }
      ]);

      if (sessErr) {
        console.error("[reverse-portal-auth] Error guardando sesión:", sessErr);
        return new Response(JSON.stringify({ error: "Error iniciando sesión segura." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        session_token: rawSessionToken,
        email: rawEmail,
        scope_comercio: scopeComercio,
        expires_at: sessionExpiresAt
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // =========================================================================
    // 3. VALIDAR O CERRAR SESIÓN
    // =========================================================================
    if (action === "validate_session" || action === "logout") {
      const rawToken = String(body.session_token || req.headers.get("x-buyer-session") || "").trim();
      if (!rawToken) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const tokenHash = await sha256Hex(rawToken);

      if (action === "logout") {
        await supabase
          .from("buyer_portal_sessions")
          .update({ revoked_at: new Date().toISOString() })
          .eq("session_token_hash", tokenHash);
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: sess } = await supabase
        .from("buyer_portal_sessions")
        .select("email, scope_comercio, expires_at, revoked_at")
        .eq("session_token_hash", tokenHash)
        .maybeSingle();

      if (!sess || sess.revoked_at || new Date(sess.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        valid: true,
        email: sess.email,
        scope_comercio: sess.scope_comercio,
        expires_at: sess.expires_at
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "Acción desconocida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err: any) {
    console.error("[reverse-portal-auth] Exception:", err);
    return new Response(JSON.stringify({ error: err.message || "Error interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
