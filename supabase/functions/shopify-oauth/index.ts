import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const shopifyClientId = Deno.env.get("SHOPIFY_CLIENT_ID") ?? "";
const shopifyClientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET") ?? "";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // =========================================================================
  // METODO POST: Sincronizar Pedidos y Productos bajo demanda
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
      
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

      if (authErr || !user) {
        console.error("Error de autenticación JWT:", authErr);
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid JWT" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const isAdmin = profile?.role === "admin";

      let body: any = {};
      try {
        body = await req.json();
      } catch (e) {}

      let targetMerchantId = user.id;
      let targetComercio = body.comercio || "";

      if (isAdmin && body.merchant_id) {
        targetMerchantId = body.merchant_id;
      }

      let query = supabase
        .from("merchant_integrations")
        .select("*")
        .eq("platform", "Shopify")
        .eq("is_active", true);

      if (targetComercio) {
        query = query.eq("comercio", targetComercio);
      }
      if (!isAdmin && !targetComercio) {
        query = query.eq("merchant_id", targetMerchantId);
      }

      const { data: integration, error: intErr } = await query.maybeSingle();

      if (intErr || !integration) {
        return new Response(JSON.stringify({ error: "Active Shopify integration not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const accessToken = await getValidShopifyToken(integration);
      integration.access_token = accessToken;

      await registerShopifyWebhooks(integration.shop_url, integration.access_token, integration.merchant_id);
      const syncedProductsCount = await syncShopifyProducts(integration);
      const syncedOrdersCount = await syncShopifyOrders(integration);

      return new Response(JSON.stringify({ 
        success: true, 
        products_count: syncedProductsCount,
        orders_count: syncedOrdersCount
      }), {
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

      const isVerified = await verifyShopifyHmac(url.searchParams, shopifyClientSecret);
      if (!isVerified) {
        console.error("Firma HMAC de OAuth inválida");
        return new Response("Unauthorized: Invalid HMAC", { status: 401 });
      }

      let merchantId = "";
      let comercio = "";
      let redirectBackUrl = "";
      try {
        const decodedState = JSON.parse(atob(stateParam));
        merchantId = decodedState.merchant_id;
        comercio = decodedState.comercio;
        redirectBackUrl = decodedState.redirect_back_url || "";

        // Validar expiración del state si incluye timestamp (ventana de 30 minutos)
        if (decodedState.timestamp && typeof decodedState.timestamp === "number") {
          const ageMs = Date.now() - decodedState.timestamp;
          if (ageMs > 30 * 60 * 1000) {
            console.warn("⚠️ State de OAuth expirado:", ageMs, "ms");
            return new Response("OAuth session expired. Please re-initiate connection from WMS dashboard.", { status: 400 });
          }
        }
      } catch (e) {
        console.error("Error decodificando state:", e);
        return new Response("Invalid state parameter", { status: 400 });
      }

      if (!merchantId) {
        return new Response("Missing merchant_id in state", { status: 400 });
      }

      const tokenUrl = `https://${shop}/admin/oauth/access_token`;
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: shopifyClientId,
          client_secret: shopifyClientSecret,
          code: code,
          expiring: 1
        })
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("Error al intercambiar token con Shopify:", errorText);
        return new Response(`Failed to exchange token: ${errorText}`, { status: 500 });
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || null;
      const grantedScopeStr = tokenData.scope || "";
      const grantedScopes = grantedScopeStr ? grantedScopeStr.split(",").map((s: string) => s.trim()) : [];
      const hasFulfillmentScope = grantedScopes.includes("write_fulfillments");

      // Obtener el comercio exacto desde el perfil del usuario si existe
      let resolvedComercio = comercio || "Shopify Store";
      try {
        const { data: userProfile } = await supabase
          .from("profiles")
          .select("comercio, company_name")
          .eq("id", merchantId)
          .maybeSingle();

        if (userProfile && (userProfile.comercio || userProfile.company_name)) {
          resolvedComercio = userProfile.comercio || userProfile.company_name;
        }
      } catch (profErr) {
        console.warn("Aviso consultando profile en OAuth:", profErr);
      }

      // Eliminar registros anteriores o duplicados para esta misma tienda que tengan otro comercio o merchant
      try {
        await supabase
          .from("merchant_integrations")
          .delete()
          .eq("platform", "Shopify")
          .eq("shop_url", shop)
          .neq("comercio", resolvedComercio);
      } catch (delErr) {
        console.warn("Aviso eliminando integraciones anteriores duplicadas:", delErr);
      }

      const upsertPayload: Record<string, any> = {
        merchant_id: merchantId,
        platform: "Shopify",
        shop_url: shop,
        access_token: accessToken,
        webhook_secret: shopifyClientSecret,
        is_active: true,
        comercio: resolvedComercio,
        refresh_token: refreshToken
      };

      if (grantedScopes.length > 0) {
        upsertPayload.granted_scopes = grantedScopes;
      }
      if (hasFulfillmentScope) {
        upsertPayload.sync_tracking_enabled = true;
      }

      const { error: dbError } = await supabase
        .from("merchant_integrations")
        .upsert(upsertPayload, { onConflict: "comercio,platform" });

      if (dbError) {
        console.error("Error guardando la integración en Supabase:", dbError);
        return new Response("Database error saving integration", { status: 500 });
      }

      await registerShopifyWebhooks(shop, accessToken, merchantId);

      // EJECUTAR SINCRONIZACION INICIAL DE PRODUCTOS Y PEDIDOS EN BACKGROUND (SIN BLOQUEAR EL REDIRECT 302)
      const integrationObj = {
        shop_url: shop,
        access_token: accessToken,
        merchant_id: merchantId,
        comercio: resolvedComercio
      };

      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(
          (async () => {
            try {
              await syncShopifyProducts(integrationObj);
              await syncShopifyOrders(integrationObj);
              console.log(`[OAuth Initial Sync Background] Sincronizados exitosamente productos y pedidos para ${shop}`);
            } catch (syncErr) {
              console.error("Error en sincronización inicial en background:", syncErr);
            }
          })()
        );
      }

      const responseHeaders = new Headers();
      const finalRedirect = redirectBackUrl 
        ? `${redirectBackUrl}?integration=success&shop=${encodeURIComponent(shop)}` 
        : `https://stocka-wms.netlify.app/dashboard.html?integration=success&shop=${encodeURIComponent(shop)}`;
        
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

async function syncShopifyProducts(integration: any): Promise<number> {
  let url = `https://${integration.shop_url}/admin/api/2024-04/products.json?limit=250`;
  let count = 0;

  while (url) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": integration.access_token,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Shopify API error products: ${response.status} - ${errorText}`);
      break;
    }

    const data = await response.json();
    const products = data.products || [];

    for (const product of products) {
      const productStatus = product.status || "active";

      for (const variant of product.variants) {
        let imageUrl = "";
        if (product.images && product.images.length > 0) {
          const variantImage = product.images.find((img: any) => img.variant_ids && img.variant_ids.includes(variant.id));
          imageUrl = variantImage ? variantImage.src : product.images[0].src;
        }

        const skuClean = (variant.sku || variant.id.toString()).trim();

        const productDataToUpsert = {
          comercio: integration.comercio,
          platform: "Shopify",
          sku: skuClean,
          name: `${product.title}${variant.title !== "Default Title" ? " - " + variant.title : ""}`,
          image_url: imageUrl || null,
          status: productStatus,
          price: parseFloat(variant.price) || 0
        };

        const { error: upsertErr } = await supabase
          .from("synced_products")
          .upsert(productDataToUpsert, { onConflict: "comercio,platform,sku" });

        if (!upsertErr) {
          count++;
        }

        // Auto-crear en la tabla master 'products' si no existe
        const { data: existingProd } = await supabase
          .from("products")
          .select("id")
          .eq("sku", skuClean)
          .eq("comercio", integration.comercio)
          .maybeSingle();

        if (!existingProd) {
          await supabase.from("products").insert([{
            merchant_id: integration.merchant_id,
            comercio: integration.comercio,
            sku: skuClean,
            name: productDataToUpsert.name,
            image_url: productDataToUpsert.image_url,
            status: productDataToUpsert.status,
            price: productDataToUpsert.price,
            description: "Importado automáticamente de Shopify"
          }]);
        }
      }
    }

    const linkHeader = response.headers.get("link");
    url = "";
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }

  return count;
}

async function syncShopifyOrders(integration: any): Promise<number> {
  let url = `https://${integration.shop_url}/admin/api/2024-04/orders.json?status=any&limit=250`;
  let count = 0;

  while (url) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Shopify-Access-Token": integration.access_token,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Shopify API error orders: ${response.status} - ${errorText}`);
      break;
    }

    const data = await response.json();
    const orders = data.orders || [];

    for (const order of orders) {
      const orderDataToSave = {
        merchant_id: integration.merchant_id,
        comercio: integration.comercio,
        external_order_number: order.name,
        external_platform: "Shopify",
        payment_status: order.financial_status,
        total_value: order.current_total_price,
        customer_email: order.contact_email || order.email || null,
        customer_phone: order.shipping_address?.phone || null,
        customer_name: order.shipping_address ? `${order.shipping_address.first_name || ''} ${order.shipping_address.last_name || ''}`.trim() : "",
        shipping_address: order.shipping_address?.address1 || null,
        shipping_city: order.shipping_address?.city || null,
        shipping_complement: order.shipping_address?.address2 || null,
        shipping_method: order.shipping_lines && order.shipping_lines.length > 0 ? order.shipping_lines[0].title : null,
        raw_shopify_data: order,
        created_at: new Date(order.created_at).toISOString(),
        status: order.cancelled_at ? "cancelado" : "para procesar",
        estado_wms: order.cancelled_at ? "Cancelado" : "En procesamiento"
      };

      const shopifyOrderIdStr = (order.id || "").toString();
      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id, status, estado_wms, raw_shopify_data, total_value, sku, item, cantidad, customer_name, customer_email, customer_phone, shipping_address, shipping_city, shipping_complement")
        .eq("comercio", integration.comercio)
        .eq("external_platform", "Shopify")
        .or(`raw_shopify_data->>id.eq.${shopifyOrderIdStr},external_order_number.eq.${order.name}`)
        .maybeSingle();

      let orderId: string;
      if (existingOrder) {
        const existingRaw = (existingOrder as any).raw_shopify_data || {};
        const isWmsItemsEdited = (existingOrder as any).wms_items_edited === true || existingRaw.wms_items_edited === true;
        const isWmsShippingEdited = (existingOrder as any).wms_shipping_edited === true || existingRaw.wms_shipping_edited === true;
        
        const orderDataToUpdate = { ...orderDataToSave };
        if (isWmsItemsEdited) {
          delete (orderDataToUpdate as any).sku;
          delete (orderDataToUpdate as any).item;
          delete (orderDataToUpdate as any).cantidad;
          delete (orderDataToUpdate as any).total_value;
        }

        if (isWmsShippingEdited) {
          delete (orderDataToUpdate as any).customer_name;
          delete (orderDataToUpdate as any).customer_email;
          delete (orderDataToUpdate as any).customer_phone;
          delete (orderDataToUpdate as any).shipping_address;
          delete (orderDataToUpdate as any).shipping_city;
          delete (orderDataToUpdate as any).shipping_complement;
        }

        orderDataToUpdate.raw_shopify_data = {
          ...order,
          ...(isWmsItemsEdited ? { wms_items_edited: true } : {}),
          ...(isWmsShippingEdited ? { wms_shipping_edited: true } : {}),
          ...((existingRaw.wms_custom_edited || isWmsItemsEdited || isWmsShippingEdited) ? { wms_custom_edited: true } : {})
        };

        await supabase.from("orders").update(orderDataToUpdate).eq("id", existingOrder.id);
        orderId = existingOrder.id;

        if (isWmsItemsEdited || ['despachado', 'entregado', 'retirado', 'cancelado'].includes(existingOrder.status)) {
          count++;
          continue;
        }
      } else {
        const { data: newOrder } = await supabase.from("orders").insert([orderDataToSave]).select("id").single();
        if (newOrder) orderId = newOrder.id;
        else continue;
      }

      // Sincronizar ítems con Smart Diffing
      const { data: existingItems } = await supabase
        .from("order_items")
        .select("id, product_id, quantity, warehouse_id")
        .eq("order_id", orderId);

      const existingMap = new Map((existingItems || []).map((i: any) => [i.product_id, i]));
      const processedProductIds = new Set();
      const lineItems = order.line_items || [];

      for (const item of lineItems) {
        const targetSku = (item.sku || item.variant_id?.toString() || "").trim();
        if (!targetSku) continue;

        let { data: product } = await supabase
          .from("products")
          .select("id")
          .eq("sku", targetSku)
          .eq("comercio", integration.comercio)
          .maybeSingle();

        if (!product) {
          const { data: newProd } = await supabase
            .from("products")
            .insert([{
              merchant_id: integration.merchant_id,
              comercio: integration.comercio,
              sku: targetSku,
              name: `${item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ' - ' + item.variant_title : ''}`,
              price: item.price ? parseFloat(item.price) : 0,
              description: "Creado automáticamente desde sincronización inicial de Shopify",
              status: "active"
            }])
            .select("id")
            .single();
          product = newProd;
        }

        if (product) {
          processedProductIds.add(product.id);
          const existing = existingMap.get(product.id);

          if (existing) {
            if (existing.quantity !== item.quantity) {
              await supabase.from("order_items").update({
                quantity: item.quantity
              }).eq("id", existing.id);
            }
          } else {
            await supabase.from("order_items").insert([{
              order_id: orderId,
              product_id: product.id,
              quantity: item.quantity
            }]);
          }
        }
      }

      for (const [prodId, existingItem] of existingMap.entries()) {
        if (!processedProductIds.has(prodId)) {
          await supabase.from("order_items").delete().eq("id", (existingItem as any).id);
        }
      }
      count++;
    }

    const linkHeader = response.headers.get("link");
    url = "";
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        url = nextMatch[1];
      }
    }
  }

  return count;
}

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

  await Promise.all(
    webhookTopics.map(async (topic) => {
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
    })
  );
}

async function getValidShopifyToken(integration: any): Promise<string> {
  if (!integration.refresh_token) {
    return integration.access_token;
  }

  console.log(`[Shopify OAuth] Renovando token de acceso para ${integration.shop_url}...`);
  const tokenUrl = `https://${integration.shop_url}/admin/oauth/access_token`;
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: shopifyClientId,
        client_secret: shopifyClientSecret,
        grant_type: "refresh_token",
        refresh_token: integration.refresh_token
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Shopify OAuth] Error renovando token: ${res.status} - ${errorText}`);
      return integration.access_token;
    }

    const data = await res.json();
    console.log(`[Shopify OAuth] Token renovado con éxito.`);

    await supabase
      .from("merchant_integrations")
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token
      })
      .eq("id", integration.id);

    return data.access_token;
  } catch (e) {
    console.error("[Shopify OAuth] Excepción renovando token:", e);
    return integration.access_token;
  }
}
