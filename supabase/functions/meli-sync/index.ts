import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req) => {
  // CORS configuration
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
      
      // 1. Validate the user session
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

      if (authErr || !user) {
        console.error("JWT Auth Error:", authErr);
        return new Response(JSON.stringify({ error: "Unauthorized: Invalid JWT" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Parse request body for comercio
      const body = await req.json();
      const comercio = body.comercio;

      if (!comercio) {
        return new Response(JSON.stringify({ error: "Missing comercio in request body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Fetch the active MercadoLibre integration for this merchant and commerce
      const { data: integration, error: intErr } = await supabase
        .from("merchant_integrations")
        .select("*")
        .eq("platform", "MercadoLibre")
        .eq("merchant_id", user.id)
        .eq("comercio", comercio)
        .eq("is_active", true)
        .maybeSingle();

      if (intErr || !integration) {
        console.error("Integration Query Error / Not Found:", intErr, integration);
        return new Response(JSON.stringify({ error: `Active MercadoLibre integration not found for commerce ${comercio}` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Trigger catalog synchronization
      const count = await syncMeliProducts(integration);

      return new Response(JSON.stringify({ success: true, count: count }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e) {
      console.error("Error in MercadoLibre manual sync:", e);
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});

async function syncMeliProducts(integration: any): Promise<number> {
  const credentials = await getValidAccessToken(integration);
  if (!credentials) {
    throw new Error("No se pudo obtener sesión activa para MercadoLibre (refresh token vencido o inválido)");
  }

  const { accessToken, userId } = credentials;

  // Load SKU equivalences
  const skuMap: Record<string, string> = {};
  const { data: equivalences } = await supabase
    .from('sku_equivalences')
    .select('platform_sku, master_sku, platform')
    .eq('comercio', integration.comercio);
  
  if (equivalences) {
    equivalences.filter((e: any) => e.platform === 'Todas').forEach((e: any) => {
      if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
    });
    equivalences.filter((e: any) => e.platform === 'MercadoLibre').forEach((e: any) => {
      if (e.platform_sku) skuMap[e.platform_sku.trim().replace(/\s+/g, '')] = e.master_sku.trim();
    });
  }

  let offset = 0;
  const limit = 50;
  let hasMore = true;
  const allItemIds: string[] = [];

  // Phase A: Get all item IDs
  while (hasMore) {
    const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search?limit=${limit}&offset=${offset}`;
    const response = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      throw new Error(`Error al buscar items del vendedor: Status ${response.status}`);
    }

    const json = await response.json();
    const results = json.results || [];
    allItemIds.push(...results);

    offset += results.length;
    hasMore = results.length > 0 && json.paging && json.paging.total > offset;
  }

  console.log(`Se encontraron ${allItemIds.length} publicaciones de productos en MercadoLibre.`);

  let count = 0;
  const batchSize = 20;

  // Phase B: Get item details in batches and upsert to database
  for (let i = 0; i < allItemIds.length; i += batchSize) {
    const batch = allItemIds.slice(i, i + batchSize);
    const multigetUrl = `https://api.mercadolibre.com/items?ids=${batch.join(',')}`;
    
    const response = await fetch(multigetUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      console.error(`Error al obtener lote de productos: Status ${response.status}`);
      continue;
    }

    const itemsDetails = await response.json();

    for (const itemWrapper of itemsDetails) {
      if (itemWrapper.code !== 200 || !itemWrapper.body) continue;

      const itemDetail = itemWrapper.body;

      // Handle items with variations
      if (itemDetail.variations && itemDetail.variations.length > 0) {
        for (const variation of itemDetail.variations) {
          const rawSku = getMeliSku(variation, variation.id.toString());
          const cleanSku = rawSku.trim().replace(/\s+/g, '');
          const mappedSku = skuMap[cleanSku] || cleanSku;

          let variantName = itemDetail.title;
          if (variation.attribute_combinations && variation.attribute_combinations.length > 0) {
            const combos = variation.attribute_combinations.map((a: any) => a.value_name).filter(Boolean).join(', ');
            if (combos) variantName += ` - ${combos}`;
          }

          const barcode = getBarcodeFromAttributes(variation.attributes, cleanSku);
          const price = variation.price || itemDetail.price || 0;

          const productDataToUpsert = {
            merchant_id: integration.merchant_id,
            comercio: integration.comercio,
            sku: mappedSku,
            name: variantName,
            description: itemDetail.description || `Publicación MercadoLibre ${itemDetail.id} - Variación ${variation.id}`,
            barcode: barcode,
            price: price,
            meli_item_id: itemDetail.id,
            meli_variation_id: variation.id.toString(),
            raw_meli_data: { ...variation, base_item_title: itemDetail.title, base_item_id: itemDetail.id }
          };

          const { error: upsertErr } = await supabase
            .from("products")
            .upsert(productDataToUpsert, { onConflict: "merchant_id,sku" });

          if (upsertErr) {
            console.error(`Error al guardar variación SKU ${mappedSku}:`, upsertErr.message);
          } else {
            count++;
          }
        }
      } else {
        // Handle items without variations
        const rawSku = getMeliSku(itemDetail, itemDetail.id);
        const cleanSku = rawSku.trim().replace(/\s+/g, '');
        const mappedSku = skuMap[cleanSku] || cleanSku;

        const barcode = getBarcodeFromAttributes(itemDetail.attributes, cleanSku);
        const price = itemDetail.price || 0;

        const productDataToUpsert = {
          merchant_id: integration.merchant_id,
          comercio: integration.comercio,
          sku: mappedSku,
          name: itemDetail.title,
          description: itemDetail.description || `Publicación MercadoLibre ${itemDetail.id}`,
          barcode: barcode,
          price: price,
          meli_item_id: itemDetail.id,
          meli_variation_id: null,
          raw_meli_data: itemDetail
        };

        const { error: upsertErr } = await supabase
          .from("products")
          .upsert(productDataToUpsert, { onConflict: "merchant_id,sku" });

        if (upsertErr) {
          console.error(`Error al guardar producto SKU ${mappedSku}:`, upsertErr.message);
        } else {
          count++;
        }
      }
    }
  }

  return count;
}

async function getValidAccessToken(integration: any) {
  const tokenUrl = 'https://api.mercadolibre.com/oauth/token';

  // Case A: Has refresh token
  if (integration.refresh_token) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      refresh_token: integration.refresh_token
    });

    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) {
        throw new Error(`Token refresh failed: ${res.status}`);
      }

      const data = await res.json();
      
      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          username: String(data.user_id)
        })
        .eq('id', integration.id);

      return { accessToken: data.access_token, userId: data.user_id };
    } catch (e) {
      console.error("Error al renovar token:", e.message);
      return null;
    }
  }

  // Case B: Authorization code exchange
  if (integration.access_token && !integration.refresh_token) {
    console.log(`🔌 Realizando intercambio de código inicial (authorization_code) para ${integration.comercio}...`);
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: integration.client_id,
      client_secret: integration.client_secret,
      code: integration.access_token,
      redirect_uri: integration.shop_url || 'https://www.google.com'
    });

    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error en authorization_code flow: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      console.log(`✅ Código intercambiado correctamente. Registrando refresh_token...`);

      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          username: String(data.user_id)
        })
        .eq('id', integration.id);

      return { accessToken: data.access_token, userId: data.user_id };
    } catch (e) {
      console.error(`❌ Error al intercambiar código:`, e.message);
      return null;
    }
  }

  return null;
}

function getMeliSku(itemOrVariation: any, fallback: string): string {
  let sku = itemOrVariation.seller_custom_field || 'Sin SKU';
  if ((sku === 'Sin SKU' || sku === '') && itemOrVariation.attributes) {
    const skuAttr = itemOrVariation.attributes.find((a: any) => a.id === 'SELLER_SKU');
    if (skuAttr && skuAttr.value_name) sku = skuAttr.value_name;
  }
  sku = sku.trim().replace(/\s+/g, '');
  if (sku === 'SinSKU' || sku === 'SinSKU' || sku === '') {
    return fallback;
  }
  return sku;
}

function getBarcodeFromAttributes(attributes: any[] | undefined, fallback: string): string {
  if (!attributes) return fallback;
  const barcodeAttr = attributes.find((a: any) => a.id === 'GTIN' || a.id === 'EAN' || a.id === 'UPC');
  return barcodeAttr && barcodeAttr.value_name ? barcodeAttr.value_name.trim() : fallback;
}
