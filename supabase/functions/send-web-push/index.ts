import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(sig);
}

async function hkdfExpandSingleBlock(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const input = concatBytes(info, new Uint8Array([0x01]));
  const full = await hmacSha256(prk, input);
  return full.slice(0, length);
}

/**
 * Importa la llave privada VAPID (P-256) a partir de VAPID_PUBLIC_KEY (65B raw b64url)
 * y VAPID_PRIVATE_KEY (32B d scalar b64url).
 */
async function importVapidPrivateKey(publicKeyB64: string, privateKeyB64: string): Promise<CryptoKey> {
  const rawPub = base64UrlDecode(publicKeyB64);
  if (rawPub.length !== 65 || rawPub[0] !== 0x04) {
    throw new Error("VAPID_PUBLIC_KEY inválida (se esperan 65 bytes uncompressed P-256)");
  }
  const x = base64UrlEncode(rawPub.slice(1, 33));
  const y = base64UrlEncode(rawPub.slice(33, 65));
  return await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      d: privateKeyB64.trim(),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

/**
 * Construye el token JWT ES256 para el encabezado Authorization VAPID (RFC 8292).
 */
async function buildVapidAuthHeader(
  endpoint: string,
  vapidSubject: string,
  vapidPublicKey: string,
  vapidPrivateKey: CryptoKey
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h (cumple <=24h de APNs/FCM)

  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify({ aud: audience, exp, sub: vapidSubject })));
  const unsigned = `${headerB64}.${payloadB64}`;

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      vapidPrivateKey,
      encoder.encode(unsigned)
    )
  );
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;
  return `vapid t=${jwt}, k=${vapidPublicKey}`;
}

/**
 * Cifra el payload JSON según RFC 8291 + RFC 8188 (Content-Encoding: aes128gcm).
 */
async function encryptWebPushPayload(
  payloadJson: string,
  p256dhB64: string,
  authB64: string
): Promise<Uint8Array> {
  const uaPublicBytes = base64UrlDecode(p256dhB64);
  const authSecretBytes = base64UrlDecode(authB64);
  if (uaPublicBytes.length !== 65 || uaPublicBytes[0] !== 0x04) {
    throw new Error("Suscripción p256dh inválida");
  }
  if (authSecretBytes.length !== 16) {
    throw new Error("Suscripción auth inválida");
  }

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const asKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const asPublicBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", asKeyPair.publicKey)
  );

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPublicKey },
      asKeyPair.privateKey,
      256
    )
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // RFC 8291 Section 3.3
  const prkKey = await hmacSha256(authSecretBytes, ecdhSecret);
  const keyInfo = concatBytes(encoder.encode("WebPush: info\0"), uaPublicBytes, asPublicBytes);
  const ikm = await hkdfExpandSingleBlock(prkKey, keyInfo, 32);

  // RFC 8188 Section 2.2 & 2.3
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpandSingleBlock(prk, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpandSingleBlock(prk, encoder.encode("Content-Encoding: nonce\0"), 12);

  // Plaintext + final record delimiter 0x02
  const plaintext = concatBytes(encoder.encode(payloadJson), new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext)
  );

  // Header: salt (16B) || rs (4B BE = 4096) || idlen (1B = 65) || asPublic (65B)
  const rsBytes = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idLenByte = new Uint8Array([asPublicBytes.length]); // 65

  return concatBytes(salt, rsBytes, idLenByte, asPublicBytes, ciphertext);
}

async function sendSinglePush(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payloadJson: string,
  vapidSubject: string,
  vapidPublicKey: string,
  vapidPrivateKey: CryptoKey,
  options: { ttl?: number; urgency?: string } = {}
): Promise<{ ok: boolean; status: number; expired: boolean; error?: string }> {
  try {
    const encryptedBody = await encryptWebPushPayload(payloadJson, sub.p256dh, sub.auth);
    const authorization = await buildVapidAuthHeader(
      sub.endpoint,
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    );

    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttl ?? 86400),
        Urgency: options.urgency || "normal",
      },
      body: encryptedBody,
    });

    if (res.ok) {
      return { ok: true, status: res.status, expired: false };
    }

    const errText = await res.text().catch(() => "");
    const expired = res.status === 404 || res.status === 410;
    return {
      ok: false,
      status: res.status,
      expired,
      error: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      expired: false,
      error: err?.message || String(err),
    };
  }
}

const CATEGORY_COLUMN_MAP: Record<string, string> = {
  billing: "push_billing",
  tickets: "push_tickets",
  inbounds: "push_inbounds",
  incidents: "push_incidents",
  stock: "push_stock_alerts",
  announcements: "push_announcements",
};

function sanitizeUrl(rawUrl: unknown, fallback = "/panel"): string {
  const s = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!s) return fallback;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith("stocka.cl") || u.hostname === "localhost") {
      return u.pathname + u.search + u.hash;
    }
  } catch (_) {}
  return fallback;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const vapidPublicKey = (Deno.env.get("VAPID_PUBLIC_KEY") ?? "").trim();
    const vapidPrivateKeyRaw = (Deno.env.get("VAPID_PRIVATE_KEY") ?? "").trim();
    const vapidSubject = (Deno.env.get("VAPID_SUBJECT") ?? "mailto:info@stocka.cl").trim();
    const internalSecret = (Deno.env.get("WEB_PUSH_INTERNAL_SECRET") ?? "").trim();

    if (!vapidPublicKey || !vapidPrivateKeyRaw) {
      return new Response(
        JSON.stringify({ error: "VAPID keys no configuradas en Supabase Secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const body = await req.json();

    // 1. Autenticación y autorización del invocador
    const pushSecretHeader = (req.headers.get("x-push-secret") ?? "").trim();
    const authHeader = (req.headers.get("Authorization") ?? "").trim();
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    let callerPrivilege: "internal" | "admin" | "client" | null = null;
    let callerUserId: string | null = null;

    if (internalSecret && pushSecretHeader && pushSecretHeader === internalSecret) {
      callerPrivilege = "internal";
    } else if (bearerToken && bearerToken === supabaseServiceKey) {
      callerPrivilege = "internal";
    } else if (bearerToken) {
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(bearerToken);
      if (!userErr && userData?.user) {
        callerUserId = userData.user.id;
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", callerUserId)
          .maybeSingle();
        callerPrivilege = prof?.role === "admin" ? "admin" : "client";
      }
    }

    if (!callerPrivilege) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Resolver destinatarios con control de privilegios
    const isTestSelf = Boolean(body.test_self);
    const clientEvent = typeof body.client_event === "string" ? body.client_event.trim() : "";

    let category = typeof body.category === "string" ? body.category.trim().toLowerCase() : "general";
    let title = String(body.title || "STOCKA WMS").trim().slice(0, 140);
    let messageBody = String(body.body || "Tienes una nueva actualización en tu portal.").trim().slice(0, 280);
    let targetUrl = sanitizeUrl(body.url, callerPrivilege === "admin" && body.role === "admin" ? "/admin" : "/panel");
    const tag = typeof body.tag === "string" && body.tag.trim() ? body.tag.trim().slice(0, 80) : undefined;
    const requireInteraction = Boolean(body.requireInteraction);
    const renotify = Boolean(body.renotify);
    const urgency = requireInteraction ? "high" : (body.urgency === "high" ? "high" : "normal");

    const targetUserIds = new Set<string>();
    let targetSummary = "";

    if (isTestSelf) {
      if (!callerUserId) {
        return new Response(JSON.stringify({ error: "test_self requiere sesión de usuario" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      targetUserIds.add(callerUserId);
      category = "test";
      const portalDefault = body.portal === "admin" ? "/admin" : "/panel";
      title = body.title ? String(body.title).slice(0, 140) : "✅ Avisos activos en STOCKA WMS";
      messageBody = body.body
        ? String(body.body).slice(0, 280)
        : "¡Listo! Recibirás alertas al instante de facturas, tickets, ingresos y tu operación.";
      targetUrl = sanitizeUrl(body.url, portalDefault);
      targetSummary = `test_self:${callerUserId}`;
    } else if (callerPrivilege === "client") {
      // Un cliente autenticado SOLO puede disparar eventos explícitamente permitidos hacia admins
      if (clientEvent === "inbound_created") {
        const { data: admins } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("role", "admin");
        (admins || []).forEach((a: any) => a?.id && targetUserIds.add(a.id));
        category = "inbounds";
        targetUrl = "/admin/ingresos";
        targetSummary = "admins:inbound_created";
      } else {
        return new Response(JSON.stringify({ error: "Permisos insuficientes para emitir notificaciones push" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // Privilegio internal o admin: resolver user_ids, comercio y role
      if (Array.isArray(body.user_ids)) {
        body.user_ids.forEach((uid: any) => {
          if (typeof uid === "string" && uid.trim()) targetUserIds.add(uid.trim());
        });
      }

      if (typeof body.comercio === "string" && body.comercio.trim() && body.comercio.trim().toLowerCase() !== "no asignado") {
        const targetComLower = body.comercio.trim().toLowerCase();
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, comercio, role")
          .neq("role", "admin");
        (profiles || []).forEach((p: any) => {
          if (!p?.id || !p?.comercio) return;
          const list = String(p.comercio).split(",").map((c) => c.trim().toLowerCase());
          if (list.includes(targetComLower)) {
            targetUserIds.add(p.id);
          }
        });
        targetSummary = targetSummary ? `${targetSummary}+comercio:${body.comercio}` : `comercio:${body.comercio}`;
      }

      if (typeof body.role === "string" && ["admin", "client", "all"].includes(body.role)) {
        let q = supabaseAdmin.from("profiles").select("id, role");
        if (body.role === "admin") {
          q = q.eq("role", "admin");
        } else if (body.role === "client") {
          q = q.neq("role", "admin");
        }
        const { data: roleProfiles } = await q;
        (roleProfiles || []).forEach((p: any) => p?.id && targetUserIds.add(p.id));
        targetSummary = targetSummary ? `${targetSummary}+role:${body.role}` : `role:${body.role}`;
      }

      if (!targetSummary) {
        targetSummary = `users:${targetUserIds.size}`;
      }
    }

    // Excluir emisor si aplica (ej. el mismo admin que respondió un ticket)
    if (body.exclude_user_id && typeof body.exclude_user_id === "string") {
      targetUserIds.delete(body.exclude_user_id);
    }

    if (targetUserIds.size === 0) {
      return new Response(
        JSON.stringify({ success: true, attempted: 0, sent: 0, failed: 0, expired_cleaned: 0, message: "Sin destinatarios" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const candidateUserIds = Array.from(targetUserIds);

    // 3. Filtrar por preferencias Push en notification_settings (salvo test_self)
    let eligibleUserIds = candidateUserIds;
    if (!isTestSelf) {
      const catCol = CATEGORY_COLUMN_MAP[category];
      const { data: settingsRows } = await supabaseAdmin
        .from("notification_settings")
        .select("user_id, push_enabled, push_billing, push_tickets, push_inbounds, push_incidents, push_stock_alerts, push_announcements")
        .in("user_id", candidateUserIds);

      if (settingsRows && settingsRows.length > 0) {
        const settingsMap = new Map<string, any>();
        settingsRows.forEach((row: any) => settingsMap.set(row.user_id, row));

        eligibleUserIds = candidateUserIds.filter((uid) => {
          const s = settingsMap.get(uid);
          if (!s) return true; // Sin fila aún -> habilitado por defecto al estar suscrito
          if (s.push_enabled === false) return false;
          if (catCol && s[catCol] === false) return false;
          return true;
        });
      }
    }

    if (eligibleUserIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, attempted: 0, sent: 0, failed: 0, expired_cleaned: 0, message: "Destinatarios con categoría push desactivada" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Obtener suscripciones activas
    let subQuery = supabaseAdmin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, portal")
      .in("user_id", eligibleUserIds)
      .eq("is_active", true);

    if (body.portal && (body.portal === "client" || body.portal === "admin") && !isTestSelf) {
      subQuery = subQuery.eq("portal", body.portal);
    }

    const { data: subscriptions, error: subErr } = await subQuery;
    if (subErr) throw subErr;

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, attempted: 0, sent: 0, failed: 0, expired_cleaned: 0, message: "Sin dispositivos suscritos" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Preparar payload Web Push e importar llave privada VAPID una sola vez
    const vapidPrivateKey = await importVapidPrivateKey(vapidPublicKey, vapidPrivateKeyRaw);

    const pushPayloadObj: Record<string, unknown> = {
      title,
      body: messageBody,
      url: targetUrl,
      category,
      icon: "/img/pwa/icon-192.png",
      badge: "/img/pwa/badge-96.png",
      tag: tag || `stocka-${category}-${Date.now()}`,
      renotify,
      requireInteraction,
      timestamp: Date.now(),
    };

    if (typeof body.image === "string" && body.image.startsWith("https://")) {
      pushPayloadObj.image = body.image;
    }

    const payloadJson = JSON.stringify(pushPayloadObj);

    // 6. Enviar en lotes concurrentes (máx. 15 en paralelo)
    let sentCount = 0;
    let failedCount = 0;
    const expiredIds: string[] = [];
    const errorUpdates: Array<{ id: string; error: string }> = [];

    const BATCH_SIZE = 15;
    for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
      const batch = subscriptions.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (sub: any) => {
          const result = await sendSinglePush(
            sub,
            payloadJson,
            vapidSubject,
            vapidPublicKey,
            vapidPrivateKey,
            { ttl: Number(body.ttl) || 86400, urgency }
          );
          return { sub, result };
        })
      );

      for (const { sub, result } of results) {
        if (result.ok) {
          sentCount++;
        } else {
          failedCount++;
          if (result.expired) {
            expiredIds.push(sub.id);
          } else if (result.error) {
            errorUpdates.push({ id: sub.id, error: result.error });
          }
        }
      }
    }

    // 7. Auto-limpieza de endpoints caducados (404 / 410 Gone)
    if (expiredIds.length > 0) {
      await supabaseAdmin
        .from("push_subscriptions")
        .update({ is_active: false, last_error: "Subscription expired (404/410)" })
        .in("id", expiredIds);
    }

    if (errorUpdates.length > 0) {
      await Promise.all(
        errorUpdates.slice(0, 20).map((u) =>
          supabaseAdmin
            .from("push_subscriptions")
            .update({ last_error: u.error.slice(0, 250) })
            .eq("id", u.id)
        )
      );
    }

    // 8. Registrar log de auditoría
    try {
      await supabaseAdmin.from("push_notification_logs").insert([{
        category,
        title,
        body: messageBody,
        target_summary: targetSummary,
        url: targetUrl,
        attempted_count: subscriptions.length,
        sent_count: sentCount,
        failed_count: failedCount,
        expired_cleaned: expiredIds.length,
        triggered_by: callerUserId,
      }]);
    } catch (_) {}

    return new Response(
      JSON.stringify({
        success: true,
        attempted: subscriptions.length,
        sent: sentCount,
        failed: failedCount,
        expired_cleaned: expiredIds.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-web-push] Error:", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "Error interno en send-web-push" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
