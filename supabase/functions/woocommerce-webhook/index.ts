import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Configuración cliente Supabase
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wc-webhook-topic, x-wc-webhook-resource, x-wc-webhook-event, x-wc-webhook-signature, x-wc-webhook-id, x-wc-webhook-delivery-id, x-wc-webhook-source",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

serve(async (req) => {
  // Manejo de pre-flight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchant_id") || "";
    const queryComercio = url.searchParams.get("comercio") || "";
    const queryAction = url.searchParams.get("action") || "";

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (_e) {
      payload = {};
    }

    const action = payload.action || queryAction;

    // =========================================================================
    // ACCIÓN: VERIFICAR CONEXIÓN Y ESTADO DE WEBHOOKS
    // =========================================================================
    if (action === "verify_connection") {
      return await handleVerifyConnection(req, merchantId, queryComercio, payload);
    }

    // =========================================================================
    // ACCIÓN: PUENTE API WOOCOMMERCE / SHOPIFY PARA EVITAR BLOQUEOS WAF/IP EN GITHUB ACTIONS
    // =========================================================================
    if (action === "proxy_wc_api") {
      return await handleProxyWcApi(req, merchantId, queryComercio, payload);
    }
    if (action === "proxy_shopify_api") {
      return await handleProxyShopifyApi(req, merchantId, queryComercio, payload);
    }

    // =========================================================================
    // PROCESAMIENTO REGULAR DE WEBHOOKS DE WOOCOMMERCE
    // =========================================================================
    const topicHeader = req.headers.get("x-wc-webhook-topic") || "";
    const resourceHeader = req.headers.get("x-wc-webhook-resource") || "";
    const eventHeader = req.headers.get("x-wc-webhook-event") || "";
    const signatureHeader = req.headers.get("x-wc-webhook-signature") || "";
    const shopSource = req.headers.get("x-wc-webhook-source") || "";

    // 1. Buscar integración activa priorizando comercio explícito y dominio origen (soporte multi-comercio/conglomerado)
    let integration: any = null;

    if (queryComercio && queryComercio.trim()) {
      const { data } = await supabase
        .from("merchant_integrations")
        .select("*")
        .ilike("comercio", queryComercio.trim())
        .eq("platform", "WooCommerce")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) integration = data[0];
    }

    if (!integration && shopSource) {
      const sourceHost = normalizeShopHost(shopSource);
      if (sourceHost) {
        const { data } = await supabase
          .from("merchant_integrations")
          .select("*")
          .ilike("shop_url", `%${sourceHost}%`)
          .eq("platform", "WooCommerce")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(10);
        if (data && data.length > 0) {
          const exactHostMatch = data.find((row: any) => normalizeShopHost(row.shop_url) === sourceHost);
          integration = exactHostMatch || (data.length === 1 ? data[0] : null);
        }
      }
    }

    if (!integration && merchantId) {
      // Fallback legacy por merchant_id solo cuando NO hay ambigüedad (única tienda WooCommerce activa para este usuario)
      const { data } = await supabase
        .from("merchant_integrations")
        .select("*")
        .eq("merchant_id", merchantId)
        .eq("platform", "WooCommerce")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(2);
      if (data && data.length === 1) {
        integration = data[0];
      } else if (data && data.length > 1) {
        console.error(`[WooCommerce Webhook] Ambigüedad: merchant_id ${merchantId} tiene múltiples tiendas WooCommerce activas y no se pudo resolver por ?comercio ni x-wc-webhook-source (${shopSource || "vacío"}).`);
      }
    }

    // 2. Verificación de Seguridad HMAC (obligatoria si la integración tiene webhook_secret)
    if (integration && integration.webhook_secret) {
      if (!signatureHeader) {
        console.error("❌ Falta cabecera x-wc-webhook-signature en petición de WooCommerce");
        return new Response("Missing signature header", { status: 401, headers: corsHeaders });
      }

      const keyBuf = new TextEncoder().encode(integration.webhook_secret.trim());
      const key = await crypto.subtle.importKey(
        "raw",
        keyBuf,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const dataBuf = new TextEncoder().encode(rawBody);
      const signature = await crypto.subtle.sign("HMAC", key, dataBuf);
      const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

      if (signatureBase64 !== signatureHeader) {
        console.error("❌ Firma HMAC inválida para WooCommerce webhook");
        return new Response("Unauthorized: Invalid signature", { status: 401, headers: corsHeaders });
      }
    }

    // Detectar si es un Ping de prueba / Handshake de WooCommerce al guardar el webhook
    const isPingOrEmpty = !!payload.webhook_id || (!payload.id && !payload.number) || Object.keys(payload).length === 0;
    if (isPingOrEmpty) {
      console.log(`ℹ️ Webhook Ping / Handshake de WooCommerce recibido con éxito. Evento: ${topicHeader || 'ping'}`);
      return new Response(JSON.stringify({ success: true, message: "Webhook ping received successfully" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!integration) {
      console.error("❌ No se encontró integración activa de WooCommerce para merchant:", merchantId || queryComercio || shopSource);
      return new Response(JSON.stringify({ error: "Integration not configured" }), { status: 200, headers: corsHeaders });
    }

    const effectiveMerchantId = integration.merchant_id;
    const effectiveComercio = integration.comercio;

    const topic = topicHeader || (resourceHeader && eventHeader ? `${resourceHeader}.${eventHeader}` : "order.created");
    console.log(`📥 [WooCommerce Webhook] Evento: ${topic} para ${effectiveComercio} (Ref: ${payload.number || payload.id || "N/A"})`);

    // Procesar eventos según el topic
    if (topic === "order.created" || topic === "action.woocommerce_new_order") {
      await handleWooOrderCreate(effectiveMerchantId, effectiveComercio, payload);
    } 
    else if (topic === "order.updated" || topic === "action.woocommerce_update_order") {
      await handleWooOrderUpdate(effectiveMerchantId, effectiveComercio, payload);
    } 
    else if (topic === "order.deleted") {
      await handleWooOrderDelete(effectiveMerchantId, effectiveComercio, payload);
    }
    else if (topic.startsWith("product.")) {
      await handleWooProductSave(effectiveMerchantId, effectiveComercio, payload);
    }

    if (integration.id) {
      try {
        await supabase
          .from("merchant_integrations")
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_error: null
          })
          .eq("id", integration.id);
      } catch (_e) {}
    }

    return new Response(JSON.stringify({ success: true, message: "Webhook processed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    console.error("❌ Error en Edge Function woocommerce-webhook:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});

// =============================================================================
// FUNCIÓN DE VERIFICACIÓN DE CONEXIÓN Y DIAGNÓSTICO
// =============================================================================

function normalizeShopHost(rawUrl: string): string {
  try {
    const cleaned = String(rawUrl || "").trim();
    if (!cleaned) return "";
    const withProto = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return String(rawUrl || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0];
  }
}

function isSafeExternalStoreUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function isValidServiceRoleToken(token: string): Promise<boolean> {
  if (!token) return false;
  if (supabaseServiceKey && token === supabaseServiceKey.trim()) return true;
  try {
    const tempClient = createClient(supabaseUrl, token, { auth: { persistSession: false } });
    const { error } = await tempClient.auth.admin.listUsers({ page: 1, perPage: 1 });
    return !error;
  } catch {
    return false;
  }
}

async function handleProxyWcApi(req: Request, merchantIdQuery: string, comercioQuery: string, payload: any) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isService = await isValidServiceRoleToken(token);
    if (!isService) {
      return new Response(JSON.stringify({ error: "Unauthorized: Service Role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const integrationId = payload.integration_id || "";
    const targetComercio = payload.comercio || comercioQuery || "";
    const targetMerchantId = payload.merchant_id || merchantIdQuery || "";
    const endpoint = String(payload.endpoint || "").trim();
    const method = String(payload.method || "GET").toUpperCase();

    if (!endpoint.startsWith("/wp-json/wc/v3/")) {
      return new Response(JSON.stringify({ error: "Invalid WooCommerce endpoint" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let query = supabase.from("merchant_integrations").select("*").eq("platform", "WooCommerce");
    if (integrationId) {
      query = query.eq("id", integrationId);
    } else if (targetComercio) {
      query = query.eq("comercio", targetComercio);
    } else if (targetMerchantId) {
      query = query.eq("merchant_id", targetMerchantId);
    } else {
      return new Response(JSON.stringify({ error: "Missing integration identifier" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: intList, error: intErr } = await query.limit(1);
    if (intErr || !intList || intList.length === 0) {
      return new Response(JSON.stringify({ error: "WooCommerce integration not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const dbInt = intList[0];
    let baseUrl = String(dbInt.shop_url || "").trim();
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = "https://" + baseUrl;
    }
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

    if (!isSafeExternalStoreUrl(baseUrl)) {
      return new Response(JSON.stringify({ error: "Unsafe external store URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const creds = JSON.parse(dbInt.access_token);
    const wcAuthHeader = "Basic " + btoa(`${String(creds.consumer_key || "").trim()}:${String(creds.consumer_secret || "").trim()}`);
    const headers: Record<string, string> = {
      "Authorization": wcAuthHeader,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    };

    const fetchOpts: RequestInit = { method, headers };
    if (payload.body && (method === "POST" || method === "PUT")) {
      fetchOpts.body = typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body);
    }

    const wcRes = await fetch(`${baseUrl}${endpoint}`, fetchOpts);
    const resText = await wcRes.text();

    return new Response(resText, {
      status: wcRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": wcRes.headers.get("Content-Type") || "application/json"
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

async function handleProxyShopifyApi(req: Request, merchantIdQuery: string, comercioQuery: string, payload: any) {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isService = await isValidServiceRoleToken(token);
    if (!isService) {
      return new Response(JSON.stringify({ error: "Unauthorized: Service Role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const integrationId = payload.integration_id || "";
    const targetComercio = payload.comercio || comercioQuery || "";
    const targetMerchantId = payload.merchant_id || merchantIdQuery || "";
    const endpoint = String(payload.endpoint || "").trim();
    const method = String(payload.method || "GET").toUpperCase();

    if (!endpoint.startsWith("/admin/api/") && !endpoint.startsWith("/admin/oauth/access_token")) {
      return new Response(JSON.stringify({ error: "Invalid Shopify endpoint" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let query = supabase.from("merchant_integrations").select("*").eq("platform", "Shopify");
    if (integrationId) {
      query = query.eq("id", integrationId);
    } else if (targetComercio) {
      query = query.eq("comercio", targetComercio);
    } else if (targetMerchantId) {
      query = query.eq("merchant_id", targetMerchantId);
    } else {
      return new Response(JSON.stringify({ error: "Missing integration identifier" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: intList, error: intErr } = await query.limit(1);
    if (intErr || !intList || intList.length === 0) {
      return new Response(JSON.stringify({ error: "Shopify integration not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const dbInt = intList[0];
    let shopDomain = String(dbInt.shop_url || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const baseUrl = `https://${shopDomain}`;

    if (!isSafeExternalStoreUrl(baseUrl)) {
      return new Response(JSON.stringify({ error: "Unsafe external store URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const isOAuthRefresh = endpoint.startsWith("/admin/oauth/access_token");
    const headers: Record<string, string> = isOAuthRefresh
      ? {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        }
      : {
          "X-Shopify-Access-Token": String(payload.access_token || dbInt.access_token || "").trim(),
          "Content-Type": "application/json",
          "Accept": "application/json"
        };

    const fetchOpts: RequestInit = { method, headers };
    if (payload.body && (method === "POST" || method === "PUT")) {
      fetchOpts.body = typeof payload.body === "string" ? payload.body : JSON.stringify(payload.body);
    }

    const shRes = await fetch(`${baseUrl}${endpoint}`, fetchOpts);
    const resText = await shRes.text();
    const linkHeader = shRes.headers.get("link");

    return new Response(resText, {
      status: shRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": shRes.headers.get("Content-Type") || "application/json",
        ...(linkHeader ? { "link": linkHeader } : {})
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

async function handleVerifyConnection(req: Request, merchantIdQuery: string, comercioQuery: string, payload: any) {
  try {
    // 1. Exigir autenticación JWT o Service Role (VULN-26)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({
        success: false,
        api_connected: false,
        error: "No autorizado: Falta cabecera Authorization."
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    let isServiceOrAdmin = false;
    let allowedComercios: string[] = [];

    if (await isValidServiceRoleToken(token)) {
      isServiceOrAdmin = true;
    } else {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "No autorizado: Sesión inválida o expirada."
        }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, comercio")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "No autorizado: Perfil no encontrado."
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const userComercioRaw = String(profile.comercio || "").trim();
      if (profile.role === "admin" || userComercioRaw.toLowerCase() === "all") {
        isServiceOrAdmin = true;
      } else {
        allowedComercios = userComercioRaw
          .split(",")
          .map((c: string) => c.trim().toLowerCase())
          .filter(Boolean);
      }
    }

    const targetComercio = payload.comercio || comercioQuery;
    const targetMerchantId = payload.merchant_id || merchantIdQuery;

    if (!isServiceOrAdmin && targetComercio) {
      if (!allowedComercios.includes(String(targetComercio).trim().toLowerCase())) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "No tienes permisos sobre este comercio."
        }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    let shopUrl = payload.shop_url;
    let consumerKey = payload.consumer_key;
    let consumerSecret = payload.consumer_secret;
    let effectiveMerchantId = targetMerchantId;
    let effectiveComercio = String(targetComercio || "").trim();

    // Si no vienen en el payload, buscar en base de datos
    if (!shopUrl || !consumerKey || !consumerSecret) {
      let query = supabase.from("merchant_integrations").select("*").eq("platform", "WooCommerce");
      if (targetComercio) {
        query = query.ilike("comercio", String(targetComercio).trim());
      } else if (targetMerchantId) {
        query = query.eq("merchant_id", targetMerchantId);
      }

      const { data: intList, error: intErr } = await query.limit(1);
      if (intErr || !intList || intList.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "No se encontró ninguna configuración guardada de WooCommerce para este comercio."
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const dbInt = intList[0];
      shopUrl = dbInt.shop_url;
      effectiveMerchantId = dbInt.merchant_id;
      effectiveComercio = String(dbInt.comercio || effectiveComercio || "").trim();

      try {
        const creds = JSON.parse(dbInt.access_token);
        consumerKey = creds.consumer_key;
        consumerSecret = creds.consumer_secret;
      } catch (_e) {
        return new Response(JSON.stringify({
          success: false,
          api_connected: false,
          error: "Las credenciales guardadas en el sistema tienen un formato inválido."
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    if (!shopUrl || !consumerKey || !consumerSecret) {
      return new Response(JSON.stringify({
        success: false,
        api_connected: false,
        error: "Faltan la URL de la tienda, Consumer Key o Consumer Secret."
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Normalizar URL
    let baseUrl = shopUrl.trim();
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = "https://" + baseUrl;
    }
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }

    if (!isSafeExternalStoreUrl(baseUrl)) {
      return new Response(JSON.stringify({
        success: false,
        api_connected: false,
        error: "La URL de la tienda no es un dominio público válido."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const wcAuthHeader = "Basic " + btoa(`${consumerKey.trim()}:${consumerSecret.trim()}`);
    const headers = {
      "Authorization": wcAuthHeader,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    };

    // 1. Probar conectividad API REST con WooCommerce
    let apiConnected = false;
    let storeName = "";
    let wcVersion = "";
    let ordersCount = 0;
    let apiError = "";

    try {
      const ordersRes = await fetch(`${baseUrl}/wp-json/wc/v3/orders?per_page=1`, { method: "GET", headers });
      if (ordersRes.ok) {
        apiConnected = true;
        const ordersData = await ordersRes.json();
        ordersCount = Array.isArray(ordersData) ? ordersData.length : 0;
      } else {
        const errText = await ordersRes.text();
        apiError = `Error HTTP ${ordersRes.status}: ${errText.substring(0, 150)}`;
      }
    } catch (err: any) {
      apiError = `No se pudo conectar con la tienda: ${err.message}`;
    }

    if (!apiConnected) {
      return new Response(JSON.stringify({
        success: false,
        api_connected: false,
        shop_url: baseUrl,
        error: apiError || "Credenciales de API inválidas o URL inaccesible."
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 2. Verificar Webhooks existentes en WooCommerce (incluyendo &comercio= para soportar conglomerados)
    const expectedWebhookUrl = `https://ejtjfaucnxbikrwjwwdu.supabase.co/functions/v1/woocommerce-webhook?merchant_id=${effectiveMerchantId}${effectiveComercio ? `&comercio=${encodeURIComponent(effectiveComercio)}` : ""}`;
    let webhooksList: any[] = [];
    let hasOrderCreatedWebhook = false;
    let hasOrderUpdatedWebhook = false;
    let pausedOrderCreatedWebhookId: number | null = null;
    let pausedOrderUpdatedWebhookId: number | null = null;
    let writePermissions = true;
    let autoRegistered = false;

    try {
      const whRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks?per_page=100`, { method: "GET", headers });
      if (whRes.ok) {
        webhooksList = await whRes.json();
        if (Array.isArray(webhooksList)) {
          const createdMatches = webhooksList.filter((w: any) =>
            w.delivery_url && (w.delivery_url.includes("/functions/v1/woocommerce-webhook") || w.delivery_url.includes("supabase.co/functions")) &&
            (w.topic === "order.created" || (w.resource === "order" && w.event === "created"))
          );
          hasOrderCreatedWebhook = createdMatches.some((w: any) => w.status === "active");
          if (!hasOrderCreatedWebhook && createdMatches[0]?.id) {
            pausedOrderCreatedWebhookId = createdMatches[0].id;
          }

          const updatedMatches = webhooksList.filter((w: any) =>
            w.delivery_url && (w.delivery_url.includes("/functions/v1/woocommerce-webhook") || w.delivery_url.includes("supabase.co/functions")) &&
            (w.topic === "order.updated" || (w.resource === "order" && w.event === "updated"))
          );
          hasOrderUpdatedWebhook = updatedMatches.some((w: any) => w.status === "active");
          if (!hasOrderUpdatedWebhook && updatedMatches[0]?.id) {
            pausedOrderUpdatedWebhookId = updatedMatches[0].id;
          }
        }
      }
    } catch (err: any) {
      console.warn("Error consultando webhooks de WooCommerce:", err.message);
    }

    // 3. Si faltan webhooks o están pausados/desactivados, reactivarlos o auto-registrarlos de manera proactiva
    if ((!hasOrderCreatedWebhook || !hasOrderUpdatedWebhook) && payload.auto_register !== false) {
      try {
        if (!hasOrderCreatedWebhook) {
          if (pausedOrderCreatedWebhookId) {
            const reactRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks/${pausedOrderCreatedWebhookId}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ status: "active", delivery_url: expectedWebhookUrl })
            });
            if (reactRes.ok) {
              hasOrderCreatedWebhook = true;
              autoRegistered = true;
            }
          }
          if (!hasOrderCreatedWebhook) {
            const createRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                name: "WMS STOCKA - Pedido Creado",
                topic: "order.created",
                delivery_url: expectedWebhookUrl,
                status: "active"
              })
            });
            if (createRes.ok) {
              hasOrderCreatedWebhook = true;
              autoRegistered = true;
            } else if (createRes.status === 401) {
              writePermissions = false;
            }
          }
        }

        if (!hasOrderUpdatedWebhook && writePermissions) {
          if (pausedOrderUpdatedWebhookId) {
            const reactRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks/${pausedOrderUpdatedWebhookId}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ status: "active", delivery_url: expectedWebhookUrl })
            });
            if (reactRes.ok) {
              hasOrderUpdatedWebhook = true;
              autoRegistered = true;
            }
          }
          if (!hasOrderUpdatedWebhook) {
            const updateRes = await fetch(`${baseUrl}/wp-json/wc/v3/webhooks`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                name: "WMS STOCKA - Pedido Actualizado",
                topic: "order.updated",
                delivery_url: expectedWebhookUrl,
                status: "active"
              })
            });
            if (updateRes.ok) {
              hasOrderUpdatedWebhook = true;
              autoRegistered = true;
            } else if (updateRes.status === 401) {
              writePermissions = false;
            }
          }
        }
      } catch (_e) {
        // Ignorar si no se pudo auto-registrar
      }
    }

    const allHealthy = apiConnected && hasOrderCreatedWebhook && hasOrderUpdatedWebhook;

    return new Response(JSON.stringify({
      success: true,
      api_connected: true,
      shop_url: baseUrl,
      merchant_id: effectiveMerchantId,
      expected_webhook_url: expectedWebhookUrl,
      write_permissions: writePermissions,
      webhooks: {
        order_created: hasOrderCreatedWebhook,
        order_updated: hasOrderUpdatedWebhook
      },
      auto_registered: autoRegistered,
      all_healthy: allHealthy,
      message: allHealthy 
        ? "¡Excelente! La API y los Webhooks en tiempo real están 100% operativos." 
        : (apiConnected && !writePermissions
            ? "API conectada (Solo Lectura). Para que los pedidos lleguen al instante, debes crear los Webhooks manualmente en WooCommerce."
            : "API conectada, pero faltan los Webhooks en tiempo real.")
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({
      success: false,
      api_connected: false,
      error: `Error interno de verificación: ${err.message}`
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

// ==========================================
// FUNCIONES DE MANEJO DE PEDIDOS
// ==========================================

function resolveWooPaymentStatus(order: any, statusName?: string): string {
  const st = String(statusName || order?.status || "").toLowerCase().trim();
  const payMethod = String(order?.payment_method || "").toLowerCase().trim();
  if (order?.date_paid) return "PAID";
  if (payMethod === "cod") {
    if (st === "refunded") return "REFUNDED";
    if (["cancelled", "failed", "trash"].includes(st)) return "PENDING";
    return "PAGO AL RETIRAR";
  }
  return (st === "processing" || st === "completed") ? "PAID" : "PENDING";
}

async function resolveWooOrderNumber(comercio: string, rawNumber: string | number): Promise<{ finalNumber: string, sigla: string }> {
  let orderNumber = String(rawNumber || "").trim();
  let siglaComercio = "";
  let prefijoOrigen = "";
  let agregarPrefijo = true;

  if (comercio) {
    try {
      const { data: configData } = await supabase
        .from("v_comercios_config")
        .select("sigla")
        .eq("nombre", comercio)
        .maybeSingle();

      if (configData && configData.sigla) {
        siglaComercio = configData.sigla.trim().toUpperCase();
      }

      const { data: adicionalConfig } = await supabase
        .from("comercios_adicional_config")
        .select("pedido_trae_sigla, plat_siglas_config")
        .eq("comercio", comercio)
        .maybeSingle();

      if (adicionalConfig) {
        const platConfig = (adicionalConfig.plat_siglas_config || {})["WooCommerce"];
        if (platConfig) {
          agregarPrefijo = platConfig.agregar_prefijo !== false;
          prefijoOrigen = (platConfig.prefijo_origen || "").trim().toUpperCase();
        } else {
          agregarPrefijo = !adicionalConfig.pedido_trae_sigla;
        }
      }
    } catch (err: any) {
      console.error("⚠️ Error consultando sigla de comercio para WooCommerce:", err.message);
    }
  }

  if (prefijoOrigen && orderNumber.toUpperCase().startsWith(prefijoOrigen)) {
    orderNumber = orderNumber.substring(prefijoOrigen.length).trim();
  }

  let finalOrderNumber = orderNumber;
  if (agregarPrefijo && siglaComercio) {
    if (!orderNumber.toUpperCase().startsWith(siglaComercio)) {
      finalOrderNumber = `${siglaComercio}${orderNumber}`;
    }
  }

  return { finalNumber: finalOrderNumber, sigla: siglaComercio };
}

async function resolveCollisionAwareWooOrder(
  comercio: string,
  baseNumber: string,
  initialFinalNumber: string,
  incomingOrderKey: string | undefined,
  selectColumns: string
): Promise<{ existingOrder: any | null; finalOrderNumber: string; isCollision: boolean }> {
  const { data: baseExisting } = await supabase
    .from("orders")
    .select(selectColumns)
    .eq("comercio", comercio)
    .in("external_order_number", [baseNumber, initialFinalNumber])
    .maybeSingle();

  if (!baseExisting) {
    return { existingOrder: null, finalOrderNumber: initialFinalNumber, isCollision: false };
  }

  const existingOrderKey = (baseExisting as any)?.raw_woocommerce_data?.order_key;
  if (!existingOrderKey || !incomingOrderKey || existingOrderKey === incomingOrderKey) {
    return {
      existingOrder: baseExisting,
      finalOrderNumber: (baseExisting as any).external_order_number || initialFinalNumber,
      isCollision: false
    };
  }

  // WooCommerce reutilizó el número de pedido con distinto order_key (p. ej. restauración de backup)
  const baseCollisionPrefix = `${initialFinalNumber}-R`;
  const { data: collisionCandidates } = await supabase
    .from("orders")
    .select(selectColumns)
    .eq("comercio", comercio)
    .ilike("external_order_number", `${baseCollisionPrefix}%`);

  const matchedCandidate = (collisionCandidates || []).find(
    (c: any) => c.raw_woocommerce_data?.order_key === incomingOrderKey
  );

  if (matchedCandidate) {
    return {
      existingOrder: matchedCandidate,
      finalOrderNumber: (matchedCandidate as any).external_order_number,
      isCollision: false
    };
  }

  const takenSet = new Set((collisionCandidates || []).map((c: any) => String(c.external_order_number).toUpperCase()));
  let suffixIdx = 1;
  let candidateNumber = baseCollisionPrefix;
  while (takenSet.has(candidateNumber.toUpperCase())) {
    suffixIdx += 1;
    candidateNumber = `${baseCollisionPrefix}${suffixIdx}`;
  }

  console.warn(`⚠️ [WooCommerce Webhook] Colisión de folio en ${initialFinalNumber} (order_key previo=${existingOrderKey}, nuevo=${incomingOrderKey}). Asignando ${candidateNumber}.`);
  return { existingOrder: null, finalOrderNumber: candidateNumber, isCollision: true };
}

async function handleWooOrderCreate(merchantId: string, comercio: string, order: any, forcedFinalNumber?: string, isCollisionOverride?: boolean) {
  if (!order || (!order.id && !order.number)) {
    console.log(`ℹ️ Payload de orden de WooCommerce sin número ni ID válido. Omitiendo.`);
    return;
  }

  // Evitar loop infinito: ignorar órdenes de reemplazo creadas por el motor de Logística Inversa de Stocka
  if (Array.isArray(order.meta_data) && order.meta_data.some((m: any) => m?.key === "_stocka_skip_webhook_import" && String(m?.value) === "true")) {
    console.log(`ℹ️ [WooCommerce Webhook] Orden ${order.number || order.id} generada por Logística Inversa Stocka (_stocka_skip_webhook_import). Omitiendo re-importación.`);
    return;
  }

  const orderId = String(order.id || "");
  const baseNumber = String(order.number || orderId).trim();
  const { finalNumber: resolvedNumber } = await resolveWooOrderNumber(comercio, baseNumber);

  let finalOrderNumber = forcedFinalNumber || resolvedNumber;
  let isCollision = Boolean(isCollisionOverride);

  if (!forcedFinalNumber) {
    const resolved = await resolveCollisionAwareWooOrder(
      comercio,
      baseNumber,
      resolvedNumber,
      order.order_key,
      "id, external_order_number, status, raw_woocommerce_data"
    );
    if (resolved.existingOrder) {
      console.log(`ℹ️ Pedido ${resolved.finalOrderNumber} ya existe en WMS. Derivando a actualización.`);
      return await handleWooOrderUpdate(merchantId, comercio, order);
    }
    finalOrderNumber = resolved.finalOrderNumber;
    isCollision = resolved.isCollision;
  }

  console.log(`[WooCommerce Webhook] Procesando nuevo pedido: ${baseNumber} -> ${finalOrderNumber}`);

  const statusName = order.status || "processing";
  const isDelivered = statusName === "completed";
  const isCancelled = ["cancelled", "failed", "refunded", "trash"].includes(statusName);
  const isActive = !isDelivered && !isCancelled;

  // Cargar equivalencias de SKU (con soporte de multiplicador)
  const skuMap: Record<string, string> = {};
  const skuMultMap: Record<string, number> = {};
  try {
    let { data: equivalences, error: eqErr } = await supabase
      .from("sku_equivalences")
      .select("platform_sku, master_sku, platform, quantity_multiplier")
      .eq("comercio", comercio);
    if (eqErr) {
      ({ data: equivalences } = await supabase
        .from("sku_equivalences")
        .select("platform_sku, master_sku, platform")
        .eq("comercio", comercio));
    }

    if (equivalences) {
      equivalences.filter((e: any) => e.platform === "Todas").forEach((e: any) => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, "");
          const mTrim = e.master_sku.trim();
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          skuMap[clean] = mTrim;
          skuMap[clean.toUpperCase()] = mTrim;
          skuMultMap[clean] = mult;
          skuMultMap[clean.toUpperCase()] = mult;
        }
      });
      equivalences.filter((e: any) => e.platform === "WooCommerce").forEach((e: any) => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, "");
          const mTrim = e.master_sku.trim();
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          skuMap[clean] = mTrim;
          skuMap[clean.toUpperCase()] = mTrim;
          skuMultMap[clean] = mult;
          skuMultMap[clean.toUpperCase()] = mult;
        }
      });
    }
  } catch (err: any) {
    console.error("⚠️ Error cargando equivalencias de SKU:", err.message);
  }

  if (!isActive) {
    console.log(`ℹ️ Pedido ${finalOrderNumber} ignorado por estar en estado no activo (${statusName}) y no existir en WMS.`);
    return;
  }

  // Mapear campos planos de la orden
  const itemNames: string[] = [];
  const itemQuantities: Record<string, number> = {};

  if (order.line_items && Array.isArray(order.line_items)) {
    for (const item of order.line_items) {
      let sku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
      sku = sku.trim().replace(/\s+/g, "");
      const mappedSku = skuMap[sku] || skuMap[sku.toUpperCase()] || sku;
      const eqMult = skuMultMap[sku] || skuMultMap[sku.toUpperCase()] || 1;
      itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + (Number(item.quantity || 1) * eqMult);
      if (item.name && !itemNames.includes(item.name)) {
        itemNames.push(item.name);
      }
    }
  }

  const flatSku = Object.keys(itemQuantities).join(", ");
  const flatItemName = itemNames.join(", ");
  const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);
  const totalValue = Number(order.total || 0);
  const orderDate = order.date_created_gmt
    ? `${order.date_created_gmt}Z`
    : (order.date_created ? new Date(order.date_created).toISOString() : new Date().toISOString());

  const orderDataToSave = {
    merchant_id: merchantId,
    comercio: comercio,
    external_order_number: finalOrderNumber,
    external_platform: "WooCommerce",
    payment_status: resolveWooPaymentStatus(order, statusName),
    total_value: totalValue,
    customer_email: order.billing?.email || "no-email@woocommerce.cl",
    customer_phone: order.billing?.phone || order.shipping?.phone || "No especificado",
    customer_name: `${order.shipping?.first_name || order.billing?.first_name || ""} ${order.shipping?.last_name || order.billing?.last_name || ""}`.trim() || "Cliente WooCommerce",
    shipping_address: order.shipping?.address_1 || order.billing?.address_1 || "No especificada",
    shipping_city: order.shipping?.city || order.billing?.city || "No especificada",
    shipping_complement: [order.shipping?.address_2 || order.billing?.address_2, order.shipping?.state || order.billing?.state, order.shipping?.postcode || order.billing?.postcode].filter(Boolean).join(", ") || "",
    shipping_method: order.shipping_lines?.[0]?.method_title || "Por definir",
    raw_woocommerce_data: order,
    origen: "WooCommerce",
    item: flatItemName,
    cantidad: flatQuantity,
    sku: flatSku,
    status: "para procesar",
    created_at: orderDate
  };

  // 1. Insertar orden en Supabase
  const { data: newOrder, error: insErr } = await supabase
    .from("orders")
    .insert([orderDataToSave])
    .select("id")
    .single();

  if (insErr || !newOrder) {
    console.error(`❌ Error al insertar pedido local ${finalOrderNumber}:`, insErr?.message);
    return;
  }

  console.log(`📥 Insertado nuevo pedido WooCommerce ${finalOrderNumber} con ID: ${newOrder.id}`);

  if (isCollision) {
    try {
      await supabase.from("order_alerts").insert([{
        merchant_id: merchantId,
        comercio: comercio,
        order_id: newOrder.id,
        alert_type: "COLISION_FOLIO_ORIGEN",
        message: `WooCommerce reutilizó un folio existente. Este pedido nuevo se registró como ${finalOrderNumber} para no sobrescribir el pedido histórico.`
      }]);
    } catch (_alertErr) {}
  }

  // 2. Obtener bodega por defecto
  let warehouseId = null;
  if (comercio) {
    const { data: adWh } = await supabase
      .from("comercios_adicional_config")
      .select("default_warehouse_id")
      .eq("comercio", comercio)
      .maybeSingle();
    if (adWh?.default_warehouse_id) {
      warehouseId = adWh.default_warehouse_id;
    }
  }
  if (!warehouseId) {
    const { data: whRel } = await supabase
      .from("merchants_warehouses")
      .select("warehouse_id")
      .eq("merchant_id", merchantId)
      .limit(1)
      .maybeSingle();

    if (whRel) {
      warehouseId = whRel.warehouse_id;
    } else {
      const { data: defaultWh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
      if (defaultWh) warehouseId = defaultWh.id;
    }
  }

  // 3. Registrar ítems en order_items (pre-expandiendo packs y consolidando cantidades por product_id)
  const expectedQuantities = new Map<string, number>();

  for (const [sku, qty] of Object.entries(itemQuantities)) {
    const itemDetail = order.line_items?.find((item: any) => {
      let itemSku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
      let cleanItemSku = itemSku.trim().replace(/\s+/g, "");
      let mappedItemSku = skuMap[cleanItemSku] || skuMap[cleanItemSku.toUpperCase()] || cleanItemSku;
      return mappedItemSku === sku;
    });
    const itemImageUrl = itemDetail?.image?.src || (typeof itemDetail?.image === "string" ? itemDetail.image : null);

    let { data: product } = await supabase
      .from("products")
      .select("id, is_pack, image_url")
      .eq("sku", sku)
      .eq("comercio", comercio)
      .maybeSingle();

    if (product && !product.image_url && itemImageUrl) {
      await supabase.from("products").update({ image_url: itemImageUrl }).eq("id", product.id);
      product.image_url = itemImageUrl;
    }

    if (!product) {
      const productName = itemDetail?.name || "Producto WooCommerce " + sku;
      const productPrice = Number(itemDetail?.price || 0);

      const { data: newProd, error: prodErr } = await supabase
        .from("products")
        .insert([{
          merchant_id: merchantId,
          comercio: comercio,
          sku: sku,
          name: productName,
          price: productPrice,
          image_url: itemImageUrl,
          description: "Creado automáticamente desde webhook de WooCommerce"
        }])
        .select("id, is_pack, image_url")
        .single();

      if (!prodErr && newProd) {
        console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}")`);
        product = newProd;
      } else {
        console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
      }
    }

    if (product && warehouseId) {
      const lineSub = Number(itemDetail?.subtotal || 0);
      const lineTot = Number(itemDetail?.total || 0);
      const qNum = Math.max(1, Number(qty || 1));
      const grossUnit = lineSub > 0 ? Math.round(lineSub / qNum) : Math.round(Number(itemDetail?.price || 0));
      const netUnit = lineTot >= 0 && itemDetail?.total !== undefined ? Math.round(lineTot / qNum) : grossUnit;
      const discUnit = Math.max(0, grossUnit - netUnit);

      if (product.is_pack) {
        const { data: packMembers } = await supabase
          .from("product_pack_items")
          .select("member_product_id, quantity")
          .eq("pack_product_id", product.id);

        if (packMembers && packMembers.length > 0) {
          for (const pm of packMembers) {
            const prev = expectedQuantities.get(pm.member_product_id);
            const addQ = Number(pm.quantity || 1) * Number(qty);
            expectedQuantities.set(pm.member_product_id, {
              qty: (prev?.qty || 0) + addQ,
              unit_price: prev?.unit_price ?? 0,
              discount_amount: 0,
              effective_unit_price: prev?.effective_unit_price ?? 0,
              image_url: prev?.image_url || null
            });
          }
        } else {
          const prev = expectedQuantities.get(product.id);
          expectedQuantities.set(product.id, {
            qty: (prev?.qty || 0) + Number(qty),
            unit_price: grossUnit,
            discount_amount: discUnit,
            effective_unit_price: netUnit,
            image_url: itemImageUrl || product.image_url || null
          });
        }
      } else {
        const prev = expectedQuantities.get(product.id);
        expectedQuantities.set(product.id, {
          qty: (prev?.qty || 0) + Number(qty),
          unit_price: grossUnit,
          discount_amount: discUnit,
          effective_unit_price: netUnit,
          image_url: itemImageUrl || product.image_url || null
        });
      }
    }
  }

  for (const [prodId, meta] of expectedQuantities.entries()) {
    const totalQty = typeof meta === "number" ? meta : meta.qty;
    if (warehouseId) {
      const { error: itemErr } = await supabase
        .from("order_items")
        .insert([{
          order_id: newOrder.id,
          product_id: prodId,
          warehouse_id: warehouseId,
          quantity: totalQty,
          unit_price: typeof meta === "object" ? (meta.unit_price ?? 0) : 0,
          discount_amount: typeof meta === "object" ? (meta.discount_amount ?? 0) : 0,
          effective_unit_price: typeof meta === "object" ? (meta.effective_unit_price ?? 0) : 0,
          image_url: typeof meta === "object" ? (meta.image_url || null) : null
        }]);

      if (itemErr) {
        console.error(`   ❌ Error al registrar ítem (product_id ${prodId}) para la orden:`, itemErr.message);
      } else {
        console.log(`   + Registrado ítem consolidado: product_id ${prodId} x ${totalQty}`);
      }
    }
  }
}

async function handleWooOrderUpdate(merchantId: string, comercio: string, order: any) {
  if (!order || (!order.id && !order.number)) {
    console.log(`ℹ️ Payload de actualización de orden sin número ni ID válido. Omitiendo.`);
    return;
  }

  const orderId = String(order.id || "");
  const baseNumber = String(order.number || orderId).trim();
  const { finalNumber: resolvedNumber } = await resolveWooOrderNumber(comercio, baseNumber);

  // Buscar pedido en BD verificando que no exista colisión de order_key
  const resolved = await resolveCollisionAwareWooOrder(
    comercio,
    baseNumber,
    resolvedNumber,
    order.order_key,
    "id, external_order_number, status, estado_wms, operador, tracking_number, fecha_procesamiento, stock_descontado, raw_woocommerce_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement"
  );

  const existingOrder = resolved.existingOrder;
  const finalOrderNumber = resolved.finalOrderNumber;

  console.log(`[WooCommerce Webhook] Actualizando pedido: ${finalOrderNumber}`);

  if (!existingOrder) {
    console.log(`ℹ️ Pedido ${finalOrderNumber} no existía en WMS (colisión=${resolved.isCollision}). Creándolo...`);
    return await handleWooOrderCreate(merchantId, comercio, order, finalOrderNumber, resolved.isCollision);
  }

  const statusName = (order.status || "").toLowerCase().trim();
  const isDelivered = statusName === "completed";
  const isCancelled = ["cancelled", "failed", "refunded", "trash"].includes(statusName);
  const isActive = !isDelivered && !isCancelled;

  // Cargar equivalencias de SKU
  const skuMap: Record<string, string> = {};
  const skuMultMap: Record<string, number> = {};
  try {
    let equivalences: any[] | null = null;
    const eqRes = await supabase
      .from("sku_equivalences")
      .select("platform_sku, master_sku, platform, quantity_multiplier")
      .eq("comercio", comercio);
    if (eqRes.error) {
      const fb = await supabase
        .from("sku_equivalences")
        .select("platform_sku, master_sku, platform")
        .eq("comercio", comercio);
      equivalences = fb.data;
    } else {
      equivalences = eqRes.data;
    }

    if (equivalences) {
      equivalences.filter((e: any) => e.platform === "Todas").forEach((e: any) => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, "");
          const mTrim = e.master_sku.trim();
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          skuMap[clean] = mTrim;
          skuMap[clean.toUpperCase()] = mTrim;
          skuMultMap[clean] = mult;
          skuMultMap[clean.toUpperCase()] = mult;
        }
      });
      equivalences.filter((e: any) => e.platform === "WooCommerce").forEach((e: any) => {
        if (e.platform_sku && e.master_sku) {
          const clean = e.platform_sku.trim().replace(/\s+/g, "");
          const mTrim = e.master_sku.trim();
          const mult = Math.max(1, Number(e.quantity_multiplier || 1));
          skuMap[clean] = mTrim;
          skuMap[clean.toUpperCase()] = mTrim;
          skuMultMap[clean] = mult;
          skuMultMap[clean.toUpperCase()] = mult;
        }
      });
    }
  } catch (err: any) {
    console.error("⚠️ Error cargando equivalencias:", err.message);
  }

  const itemNames: string[] = [];
  const itemQuantities: Record<string, number> = {};
  if (order.line_items && Array.isArray(order.line_items)) {
    for (const item of order.line_items) {
      let sku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
      sku = sku.trim().replace(/\s+/g, "");
      const mappedSku = skuMap[sku] || skuMap[sku.toUpperCase()] || sku;
      const eqMult = skuMultMap[sku] || skuMultMap[sku.toUpperCase()] || 1;
      itemQuantities[mappedSku] = (itemQuantities[mappedSku] || 0) + (Number(item.quantity || 1) * eqMult);
      if (item.name && !itemNames.includes(item.name)) {
        itemNames.push(item.name);
      }
    }
  }
  const flatSku = Object.keys(itemQuantities).join(", ");
  const flatItemName = itemNames.join(", ");
  const flatQuantity = Object.values(itemQuantities).reduce((sum, qty) => sum + qty, 0);

  const existingRaw = (existingOrder as any).raw_woocommerce_data || {};
  const isWmsItemsEdited = (existingOrder as any).wms_items_edited === true || existingRaw.wms_items_edited === true;
  const isWmsShippingEdited = (existingOrder as any).wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;

  const currentWmsState = (existingOrder.estado_wms || "En procesamiento").trim().toLowerCase();
  const currentRawStatus = (existingOrder.status || "").trim().toLowerCase();
  const estadosWmsProtegidos = ["en preparación", "pickeado", "listo para retiro", "despachado", "incidencia", "entregado", "retirado", "archivado"];
  const estadosInmutablesDespacho = ["listo para retiro", "despachado", "entregado", "retirado", "archivado"];
  const isInitiallyClosedOrDispatched =
    ["listo para retiro", "despachado", "entregado", "retirado", "cancelado"].includes(currentRawStatus) ||
    ["listo para retiro", "despachado", "entregado", "retirado", "cancelado"].includes(currentWmsState);
  const wasCancelledInWms =
    currentRawStatus === "cancelado" ||
    currentWmsState === "cancelado";
  const wasManuallyProcessedInWms =
    Boolean((existingOrder as any).operador) ||
    Boolean((existingOrder as any).tracking_number) ||
    Boolean((existingOrder as any).fecha_procesamiento) ||
    Boolean((existingOrder as any).stock_descontado) ||
    existingRaw.wms_manually_cancelled === true;

  const willBeReactivated =
    !isCancelled && isActive && statusName !== "pending" && wasCancelledInWms && !wasManuallyProcessedInWms && !estadosWmsProtegidos.includes(currentWmsState);

  const updatedData: Record<string, any> = {
    payment_status: resolveWooPaymentStatus(order, statusName),
    raw_woocommerce_data: {
      ...order,
      ...(existingRaw.admin_notes ? { admin_notes: existingRaw.admin_notes } : {}),
      ...(existingRaw.wms_admin_notes ? { wms_admin_notes: existingRaw.wms_admin_notes } : {}),
      ...(existingRaw.internal_notes ? { internal_notes: existingRaw.internal_notes } : {}),
      ...(existingRaw.wms_on_hold ? { wms_on_hold: existingRaw.wms_on_hold } : {}),
      ...(existingRaw.wms_manually_cancelled ? { wms_manually_cancelled: true } : {}),
      ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
      ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
      ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
    }
  };

  // Solo actualizar campos planos de ítems/valor si el pedido sigue editable (no editado en WMS ni en estado protegido/cerrado)
  if (!isWmsItemsEdited && (willBeReactivated || (!isInitiallyClosedOrDispatched && !estadosWmsProtegidos.includes(currentWmsState)))) {
    updatedData.total_value = Number(order.total || 0);
    if (order.line_items && Array.isArray(order.line_items)) {
      updatedData.sku = flatSku;
      updatedData.item = flatItemName;
      updatedData.cantidad = flatQuantity;
    }
  }

  // Solo actualizar datos de envío/cliente si no fue editado en WMS ni está ya despachado/cerrado
  if (!isWmsShippingEdited && !estadosInmutablesDespacho.includes(currentWmsState) && !["despachado", "entregado", "retirado"].includes(currentRawStatus)) {
    updatedData.shipping_method = order.shipping_lines?.[0]?.method_title || "Por definir";
    updatedData.customer_phone = order.billing?.phone || order.shipping?.phone || "No especificado";
    updatedData.customer_name = `${order.shipping?.first_name || order.billing?.first_name || ""} ${order.shipping?.last_name || order.billing?.last_name || ""}`.trim() || "Cliente WooCommerce";
    updatedData.shipping_address = order.shipping?.address_1 || order.billing?.address_1 || "No especificada";
    updatedData.shipping_city = order.shipping?.city || order.billing?.city || "No especificada";
    updatedData.shipping_complement = [order.shipping?.address_2 || order.billing?.address_2, order.shipping?.state || order.billing?.state, order.shipping?.postcode || order.billing?.postcode].filter(Boolean).join(", ") || "";
  }

  let wasReactivated = false;

  if (isCancelled && existingOrder.status !== "cancelado") {
    updatedData.status = "cancelado";
    if (!estadosWmsProtegidos.includes(currentWmsState)) {
      updatedData.estado_wms = "Cancelado";
    }
  } else if (willBeReactivated) {
    updatedData.status = "para procesar";
    updatedData.estado_wms = "En procesamiento";
    wasReactivated = true;
    console.log(`🔄 Pedido ${finalOrderNumber} reactivado automáticamente en WMS tras cambiar a estado '${statusName}' en WooCommerce.`);
  }

  await supabase
    .from("orders")
    .update(updatedData)
    .eq("id", existingOrder.id);

  if (wasReactivated || updatedData.status === "cancelado") {
    try {
      await supabase.rpc("recalculate_committed_stock");
    } catch (_e) {
      // Ignorar si falla el RPC auxiliar
    }
  }

  // Alertas críticas si el pedido ya está en preparación o posterior
  const rawStatus = ((updatedData.status || existingOrder.status) || "").toLowerCase();
  const rawWmsStatus = ((updatedData.estado_wms || existingOrder.estado_wms) || "").toLowerCase();
  const isClosedOrDispatched = ["listo para retiro", "despachado", "entregado", "retirado", "cancelado"].includes(rawStatus) ||
                               ["listo para retiro", "despachado", "entregado", "retirado", "cancelado"].includes(rawWmsStatus);
  const wmsStatus = updatedData.estado_wms || existingOrder.estado_wms || updatedData.status || existingOrder.status || "En procesamiento";
  const estadosCriticos = ["en preparación", "pickeado", "listo para retiro", "despachado", "incidencia", "entregado", "retirado", "cancelado"];

  if (isClosedOrDispatched || estadosCriticos.includes(wmsStatus.toLowerCase())) {
    if (isCancelled && estadosWmsProtegidos.includes(currentWmsState)) {
      await supabase.from("order_alerts").insert([{
        merchant_id: merchantId,
        comercio: comercio,
        order_id: existingOrder.id,
        alert_type: "CANCELADO_EN_PREPARACION",
        message: `¡CRÍTICO! El pedido ${finalOrderNumber} ha sido CANCELADO en WooCommerce, pero en WMS tiene estado: ${wmsStatus}. Detener preparación de inmediato.`
      }]);
    }
  } else {
    // Smart Diffing de ítems si no ha sido editado manualmente en WMS
    if (!isWmsItemsEdited && order.line_items && Array.isArray(order.line_items)) {
      const { data: existingItems } = await supabase
        .from("order_items")
        .select("id, product_id, quantity, warehouse_id, is_gift, campaign_id, tag")
        .eq("order_id", existingOrder.id);

      const existingMap = new Map(
        (existingItems || [])
          .filter((i: any) => !i.is_gift && !i.campaign_id && i.tag !== "Campaña")
          .map((i: any) => [i.product_id, i])
      );
      const processedProductIds = new Set();

      let warehouseId = null;
      if (comercio) {
        const { data: adWh } = await supabase
          .from("comercios_adicional_config")
          .select("default_warehouse_id")
          .eq("comercio", comercio)
          .maybeSingle();
        if (adWh?.default_warehouse_id) {
          warehouseId = adWh.default_warehouse_id;
        }
      }
      if (!warehouseId) {
        const { data: whRel } = await supabase
          .from("merchants_warehouses")
          .select("warehouse_id")
          .eq("merchant_id", merchantId)
          .limit(1)
          .maybeSingle();

        if (whRel) warehouseId = whRel.warehouse_id;
        else {
          const { data: defaultWh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
          if (defaultWh) warehouseId = defaultWh.id;
        }
      }

      const expectedQuantities = new Map<string, number>();

      for (const [sku, qty] of Object.entries(itemQuantities)) {
        const itemDetail = order.line_items?.find((item: any) => {
          let itemSku = item.sku || `WC-${item.product_id}${item.variation_id ? "-" + item.variation_id : ""}`;
          let cleanItemSku = itemSku.trim().replace(/\s+/g, "");
          let mappedItemSku = skuMap[cleanItemSku] || skuMap[cleanItemSku.toUpperCase()] || cleanItemSku;
          return mappedItemSku === sku;
        });
        const itemImageUrl = itemDetail?.image?.src || (typeof itemDetail?.image === "string" ? itemDetail.image : null);

        let { data: product } = await supabase
          .from("products")
          .select("id, is_pack, image_url")
          .eq("sku", sku)
          .eq("comercio", comercio)
          .maybeSingle();

        if (product && !product.image_url && itemImageUrl) {
          await supabase.from("products").update({ image_url: itemImageUrl }).eq("id", product.id);
          product.image_url = itemImageUrl;
        }

        if (!product) {
          const productName = itemDetail?.name || "Producto WooCommerce " + sku;
          const productPrice = Number(itemDetail?.price || 0);

          const { data: newProd, error: prodErr } = await supabase
            .from("products")
            .insert([{
              merchant_id: merchantId,
              comercio: comercio,
              sku: sku,
              name: productName,
              price: productPrice,
              image_url: itemImageUrl,
              description: "Creado automáticamente desde webhook de WooCommerce"
            }])
            .select("id, is_pack, image_url")
            .single();

          if (!prodErr && newProd) {
            console.log(`   * Creado automáticamente producto para SKU: ${sku} ("${productName}")`);
            product = newProd;
          } else {
            console.error(`   ❌ Error al crear producto para SKU ${sku}:`, prodErr?.message);
          }
        }

        if (product && warehouseId) {
          if (product.is_pack) {
            const { data: packMembers } = await supabase
              .from("product_pack_items")
              .select("member_product_id, quantity")
              .eq("pack_product_id", product.id);

            if (packMembers && packMembers.length > 0) {
              for (const pm of packMembers) {
                const currentQty = expectedQuantities.get(pm.member_product_id) || 0;
                expectedQuantities.set(pm.member_product_id, currentQty + (Number(pm.quantity || 1) * (qty as number)));
              }
            } else {
              const currentQty = expectedQuantities.get(product.id) || 0;
              expectedQuantities.set(product.id, currentQty + (qty as number));
            }
          } else {
            const currentQty = expectedQuantities.get(product.id) || 0;
            expectedQuantities.set(product.id, currentQty + (qty as number));
          }
        }
      }

      for (const [prodId, totalQty] of expectedQuantities.entries()) {
        processedProductIds.add(prodId);
        const existing = existingMap.get(prodId);

        if (existing) {
          const targetWarehouseId = existing.warehouse_id || warehouseId;
          if (existing.quantity !== totalQty || (!existing.warehouse_id && warehouseId)) {
            await supabase.from("order_items").update({
              quantity: totalQty,
              warehouse_id: targetWarehouseId
            }).eq("id", existing.id);
          }
        } else {
          await supabase.from("order_items").insert([{
            order_id: existingOrder.id,
            product_id: prodId,
            warehouse_id: warehouseId,
            quantity: totalQty
          }]);
        }
      }

      // Eliminar ítems removidos
      for (const [prodId, existingItem] of existingMap.entries()) {
        if (!processedProductIds.has(prodId)) {
          await supabase.from("order_items").delete().eq("id", (existingItem as any).id);
        }
      }
      console.log(`Ítems actualizados para pedido ${finalOrderNumber}`);
    }
  }
}

async function handleWooOrderDelete(_merchantId: string, comercio: string, order: any) {
  const orderId = String(order.id || "");
  const baseNumber = String(order.number || orderId).trim();
  const { finalNumber: finalOrderNumber } = await resolveWooOrderNumber(comercio, baseNumber);

  console.log(`[WooCommerce Webhook] Pedido eliminado en tienda: ${finalOrderNumber}`);

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id, estado_wms, status, raw_woocommerce_data")
    .eq("comercio", comercio)
    .in("external_order_number", [baseNumber, finalOrderNumber])
    .maybeSingle();

  if (existingOrder) {
    const existingKey = (existingOrder as any).raw_woocommerce_data?.order_key;
    if (existingKey && order?.order_key && existingKey !== order.order_key) {
      console.warn(`⚠️ [WooCommerce Webhook] Ignorando order.deleted para ${finalOrderNumber}: order_key no coincide con registro local.`);
      return;
    }
    const currentWmsState = (existingOrder.estado_wms || "En procesamiento").trim().toLowerCase();
    const estadosWmsProtegidos = ["en preparación", "pickeado", "listo para retiro", "despachado", "incidencia", "entregado", "retirado", "archivado"];
    const updatePayload: Record<string, any> = { status: "cancelado" };
    if (!estadosWmsProtegidos.includes(currentWmsState)) {
      updatePayload.estado_wms = "Cancelado";
    }
    await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", existingOrder.id);

    try {
      await supabase.rpc("recalculate_committed_stock");
    } catch (_e) {}
  }
}

async function handleWooProductSave(merchantId: string, comercio: string, product: any) {
  console.log(`[WooCommerce Webhook] Guardando producto ID ${product.id} ("${product.name}")`);

  const sku = (product.sku || `WC-${product.id}`).replace(/\s+/g, "");
  const prodImg = product.images?.[0]?.src || product.image?.src || null;
  const productData: Record<string, any> = {
    merchant_id: merchantId,
    comercio: comercio,
    sku: sku,
    name: product.name,
    price: Number(product.price || 0),
    description: "Sincronizado vía webhook de WooCommerce",
    woocommerce_product_id: String(product.id),
    raw_woocommerce_data: product
  };
  if (prodImg) productData.image_url = prodImg;

  await supabase
    .from("products")
    .upsert(productData, { onConflict: "comercio,sku" });
}
