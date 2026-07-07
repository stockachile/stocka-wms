import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const shopifyClientId = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "";
const shopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

serve(async (req) => {
  // Configuración de cabeceras CORS para permitir peticiones desde el frontend local/Netlify
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  // Manejo de peticiones preflight OPTIONS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // =========================================================================
  // METODO POST: Sincronizar Catálogo de Productos
  // =========================================================================
  if (req.method === "POST") {
    try {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      const token = authHeader.replace("Bearer ", "");
      
      // 1. Validar el token del usuario (JWT) con el cliente administrador
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

      if (authErr || !user) {
        console.error("Error de autenticación JWT:", authErr);
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid JWT" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Obtener el rol del usuario para permitir acciones de administrador
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const isAdmin = profile?.role === "admin";

      // 3. Leer el cuerpo de la petición (opcional comercio / merchant_id)
      let body: any = {};
      try {
        body = await req.json();
      } catch (e) {
        // La petición podría no llevar cuerpo
      }

      let targetMerchantId = user.id;
      let targetComercio = body.comercio || "";

      if (isAdmin && body.merchant_id) {
        targetMerchantId = body.merchant_id;
      }

      // 4. Buscar la integración activa filtrando de forma segura
      let query = supabase
        .from("merchant_integrations")
        .select("*")
        .eq("platform", "Shopify")
        .eq("is_active", true);

      if (isAdmin && targetComercio) {
        query = query.eq("comercio", targetComercio);
      } else {
        query = query.eq("merchant_id", targetMerchantId);
      }

      const { data: integration, error: intErr } = await query.maybeSingle();

      if (intErr || !integration) {
        return new Response(JSON.stringify({ error: "Active Shopify integration not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Asegurar registro de webhooks y ejecutar la sincronización
      await registerShopifyWebhooks(integration.shop_url, integration.access_token, integration.merchant_id);
      const syncedCount = await syncShopifyProducts(integration);

      return new Response(JSON.stringify({ success: true, count: syncedCount }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e) {
      console.error("Error en sincronización POST:", e);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  // =========================================================================
  // METODO GET: Callback de OAuth 2.0 (Retorno de instalación de Shopify)
  // =========================================================================
  if (req.method === "GET") {
    try {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const shop = url.searchParams.get("shop");
      const hmacParam = url.searchParams.get("hmac");
      const stateParam = url.searchParams.get("state");
      const timestamp = url.searchParams.get("timestamp");
      const host = url.searchParams.get("host");

      if (!code || !shop || !hmacParam || !stateParam || !timestamp || !host) {
        return new Response("Missing required OAuth parameters", { status: 400 });
      }

      // 1. Verificar HMAC de Shopify para validar que la petición es auténtica
      const isVerified = await verifyShopifyHmac(url.searchParams, shopifyClientSecret);
      if (!isVerified) {
        console.error("Firma HMAC de OAuth inválida");
        return new Response("Unauthorized: Invalid HMAC", { status: 401 });
      }

      // 2. Decodificar el state para obtener datos del merchant
      let merchantId = "";
      let comercio = "";
      let redirectBackUrl = "";
      try {
        const decodedState = JSON.parse(atob(stateParam));
        merchantId = decodedState.merchant_id;
        comercio = decodedState.comercio;
        redirectBackUrl = decodedState.redirect_back_url || "";
      } catch (e) {
        console.error("Error decodificando state:", e);
        return new Response("Invalid state parameter", { status: 400 });
      }

      if (!merchantId) {
        return new Response("Missing merchant_id in state", { status: 400 });
      }

      // 3. Intercambiar el código por un token permanente en Shopify
      const tokenUrl = `https://${shop}/admin/oauth/access_token`;
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: shopifyClientId,
          client_secret: shopifyClientSecret,
          code: code
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Error al intercambiar token con Shopify:", errorText);
        return new Response(`Failed to exchange token: ${errorText}`, { status: 500 });
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;

      // 4. Guardar credenciales de integración en la base de datos
      const { error: dbError } = await supabase
        .from("merchant_integrations")
        .upsert({
          merchant_id: merchantId,
          platform: "Shopify",
          shop_url: shop,
          access_token: accessToken,
          webhook_secret: shopifyClientSecret,
          is_active: true,
          comercio: comercio
        }, { onConflict: "comercio,platform" });

      if (dbError) {
        console.error("Error guardando la integración en Supabase:", dbError);
        return new Response("Database error saving integration", { status: 500 });
      }

      // 5. Suscribir automáticamente a los Webhooks necesarios en Shopify
      await registerShopifyWebhooks(shop, accessToken, merchantId);

      // 6. Redirigir de vuelta al WMS
      const responseHeaders = new Headers();
      const finalRedirect = redirectBackUrl 
        ? `${redirectBackUrl}?integration=success` 
        : `http://localhost:3000/dashboard.html?integration=success`;
        
      responseHeaders.set("Location", finalRedirect);
      return new Response(null, {
        status: 302,
        headers: responseHeaders
      });

    } catch (error) {
      console.error("Error en flujo OAuth:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

// Sincroniza productos desde la API REST de Shopify hacia la base de datos de Supabase
async function syncShopifyProducts(integration: any): Promise<number> {
  const url = `https://${integration.shop_url}/admin/api/2024-04/products.json`;
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": integration.access_token,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const products = data.products || [];
  let count = 0;

  for (const product of products) {
    const productStatus = product.status || "active";

    for (const variant of product.variants) {
      // Intentar obtener la imagen asociada a la variante o la primera del producto como fallback
      let imageUrl = "";
      if (product.images && product.images.length > 0) {
        const variantImage = product.images.find((img: any) => img.variant_ids && img.variant_ids.includes(variant.id));
        imageUrl = variantImage ? variantImage.src : product.images[0].src;
      }

      const productDataToUpsert = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        sku: variant.sku || variant.id.toString(),
        name: `${product.title} ${variant.title !== "Default Title" ? "- " + variant.title : ""}`,
        description: product.body_html || "",
        barcode: variant.barcode || null,
        price: variant.price ? parseFloat(variant.price) : 0.0,
        weight: variant.weight || null,
        shopify_product_id: product.id.toString(),
        shopify_variant_id: variant.id.toString(),
        image_url: imageUrl || null,
        shopify_stock: variant.inventory_quantity ?? 0,
        status: productStatus,
        raw_shopify_data: variant
      };

      // Realizamos upsert con la clave de servicio (bypass RLS)
      const { error: upsertErr } = await supabase
        .from("products")
        .upsert(productDataToUpsert, { onConflict: "comercio,sku" });

      if (upsertErr) {
        console.error(`Error insertando/actualizando SKU ${productDataToUpsert.sku}:`, upsertErr);
      } else {
        count++;
      }
    }
  }

  return count;
}

// Verifica el HMAC de Shopify en Deno de forma nativa sin librerías externas
async function verifyShopifyHmac(searchParams: URLSearchParams, secret: string): Promise<boolean> {
  const hmacParam = searchParams.get("hmac");
  if (!hmacParam) return false;

  const params: { key: string; val: string }[] = [];
  searchParams.forEach((value, key) => {
    if (key !== "hmac") {
      params.push({ key, val: value });
    }
  });

  params.sort((a, b) => a.key.localeCompare(b.key));
  const messageString = params.map(p => `${p.key}=${p.val}`).join("&");

  const encoder = new TextEncoder();
  const keyBuf = encoder.encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const dataBuf = encoder.encode(messageString);
  const signature = await crypto.subtle.sign("HMAC", key, dataBuf);
  
  const hashHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex === hmacParam;
}

// Registra los webhooks necesarios vía REST API en Shopify
async function registerShopifyWebhooks(shop: string, accessToken: string, merchantId: string) {
  const webhookTopics = [
    "orders/create", 
    "orders/updated", 
    "orders/cancelled",
    "products/create",
    "products/update",
    "products/delete"
  ];
  const webhookTargetUrl = `https://${new URL(supabaseUrl).hostname}/functions/v1/shopify-webhook?merchant_id=${merchantId}`;

  for (const topic of webhookTopics) {
    try {
      const response = await fetch(`https://${shop}/admin/api/2024-04/webhooks.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          webhook: {
            topic: topic,
            address: webhookTargetUrl,
            format: "json"
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Error registrando webhook ${topic} para ${shop}:`, errText);
      } else {
        console.log(`Webhook registrado con éxito: ${topic} en ${shop}`);
      }
    } catch (e) {
      console.error(`Excepción registrando webhook ${topic}:`, e);
    }
  }
}
