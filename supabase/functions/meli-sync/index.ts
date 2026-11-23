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
      const comercio = String(body.comercio || "").trim();

      if (!comercio) {
        return new Response(JSON.stringify({ error: "Missing comercio in request body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 2. Verificar que el usuario tenga permisos sobre este comercio (soporte multi-comercio/conglomerado y admin)
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, comercio")
        .eq("id", user.id)
        .maybeSingle();
      const rawProfileComercio = String(profile?.comercio || "").trim();
      const isAdmin = profile?.role === "admin" || rawProfileComercio.toLowerCase() === "all";
      const assignedComercios = rawProfileComercio
        .split(",")
        .map((c: string) => c.trim())
        .filter((c: string) => c && c.toLowerCase() !== "no asignado");

      let resolvedComercio = comercio;
      if (!isAdmin) {
        const matched = assignedComercios.find((c: string) => c.toLowerCase() === comercio.toLowerCase());
        if (!matched) {
          return new Response(JSON.stringify({ error: "Forbidden: commerce not assigned to user" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
        resolvedComercio = matched;
      }

      // 3. Fetch the active MercadoLibre integration for this commerce
      const { data: intList, error: intErr } = await supabase
        .from("merchant_integrations")
        .select("*")
        .eq("platform", "MercadoLibre")
        .ilike("comercio", resolvedComercio)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);
      const integration = intList && intList.length > 0 ? intList[0] : null;

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
      if (e.platform_sku && e.master_sku) {
        const clean = e.platform_sku.trim().replace(/\s+/g, '');
        const mTrim = e.master_sku.trim();
        skuMap[clean] = mTrim;
        skuMap[clean.toUpperCase()] = mTrim;
      }
    });
    equivalences.filter((e: any) => e.platform === 'MercadoLibre').forEach((e: any) => {
      if (e.platform_sku && e.master_sku) {
        const clean = e.platform_sku.trim().replace(/\s+/g, '');
        const mTrim = e.master_sku.trim();
        skuMap[clean] = mTrim;
        skuMap[clean.toUpperCase()] = mTrim;
      }
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
      const mainMeliImgRaw = itemDetail.pictures?.[0]?.secure_url || itemDetail.secure_thumbnail || itemDetail.thumbnail || null;
      const mainMeliImg = mainMeliImgRaw ? String(mainMeliImgRaw).replace(/^http:\/\//i, 'https://') : null;

      // Handle items with variations
      if (itemDetail.variations && itemDetail.variations.length > 0) {
        for (const variation of itemDetail.variations) {
          const rawSku = getMeliSku(variation, variation.id.toString());
          const cleanSku = rawSku.trim().replace(/\s+/g, '');
          const mappedSku = skuMap[cleanSku] || skuMap[cleanSku.toUpperCase()] || cleanSku;

          let variantName = itemDetail.title;
          if (variation.attribute_combinations && variation.attribute_combinations.length > 0) {
            const combos = variation.attribute_combinations.map((a: any) => a.value_name).filter(Boolean).join(', ');
            if (combos) variantName += ` - ${combos}`;
          }

          let varImg = mainMeliImg;
          if (Array.isArray(variation.picture_ids) && variation.picture_ids.length > 0 && Array.isArray(itemDetail.pictures)) {
            const matchedPic = itemDetail.pictures.find((p: any) => p.id === variation.picture_ids[0]);
            if (matchedPic?.secure_url || matchedPic?.url) {
              varImg = String(matchedPic.secure_url || matchedPic.url).replace(/^http:\/\//i, 'https://');
            }
          }

          const productDataToUpsert = {
            comercio: integration.comercio,
            platform: "MercadoLibre",
            sku: cleanSku,
            name: variantName,
            image_url: varImg
          };

          const { error: upsertErr } = await supabase
            .from("synced_products")
            .upsert(productDataToUpsert, { onConflict: "comercio,platform,sku" });

          if (upsertErr) {
            console.error(`Error al guardar variación SKU ${cleanSku}:`, upsertErr.message);
          } else {
            count++;
            if (varImg && integration.comercio) {
              await supabase
                .from("products")
                .update({ image_url: varImg })
                .eq("comercio", integration.comercio)
                .ilike("sku", mappedSku)
                .or("image_url.is.null,image_url.eq.");
            }
          }
        }
      } else {
        // Handle items without variations
        const rawSku = getMeliSku(itemDetail, itemDetail.id);
        const cleanSku = rawSku.trim().replace(/\s+/g, '');
        const mappedSku = skuMap[cleanSku] || skuMap[cleanSku.toUpperCase()] || cleanSku;

        const productDataToUpsert = {
          comercio: integration.comercio,
          platform: "MercadoLibre",
          sku: cleanSku,
          name: itemDetail.title,
          image_url: mainMeliImg
        };

        const { error: upsertErr } = await supabase
          .from("synced_products")
          .upsert(productDataToUpsert, { onConflict: "comercio,platform,sku" });

        if (upsertErr) {
          console.error(`Error al guardar producto SKU ${cleanSku}:`, upsertErr.message);
        } else {
          count++;
          if (mainMeliImg && integration.comercio) {
            await supabase
              .from("products")
              .update({ image_url: mainMeliImg })
              .eq("comercio", integration.comercio)
              .ilike("sku", mappedSku)
              .or("image_url.is.null,image_url.eq.");
          }
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
