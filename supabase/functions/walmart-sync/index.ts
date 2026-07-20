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

      // 2. Fetch the active Walmart integration for this merchant and commerce
      const { data: integration, error: intErr } = await supabase
        .from("merchant_integrations")
        .select("*")
        .eq("platform", "Walmart")
        .eq("merchant_id", user.id)
        .eq("comercio", comercio)
        .eq("is_active", true)
        .maybeSingle();

      if (intErr || !integration) {
        console.error("Integration Query Error / Not Found:", intErr, integration);
        return new Response(JSON.stringify({ error: `Active Walmart integration not found for commerce ${comercio}` }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Trigger catalog synchronization
      const count = await syncWalmartProducts(integration);

      return new Response(JSON.stringify({ success: true, count: count }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (e) {
      console.error("Error in Walmart manual sync:", e);
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

async function syncWalmartProducts(integration: any): Promise<number> {
  const accessToken = await getValidAccessToken(integration);
  if (!accessToken) {
    throw new Error("No se pudo obtener sesión activa para Walmart (API Key inválida o expirada)");
  }

  const correlationId = crypto.randomUUID();
  let nextCursor = '*';
  let hasMore = true;
  const itemsDetails: any[] = [];

  // Phase A: Get all items from Walmart
  while (hasMore) {
    let searchUrl = `https://marketplace.walmartapis.com/v3/items?limit=50`;
    if (nextCursor && nextCursor !== '*') {
      searchUrl += `&nextCursor=${encodeURIComponent(nextCursor)}`;
    }

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'WM_SEC.ACCESS_TOKEN': accessToken,
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': correlationId,
        'Accept': 'application/json',
        'WM_MARKET': 'cl'
      }
    });

    if (!response.ok) {
      throw new Error(`Error al buscar items del vendedor en Walmart: Status ${response.status}`);
    }

    const json = await response.json();
    const elements = json.ItemResponse || [];
    itemsDetails.push(...elements);

    nextCursor = json.nextCursor;
    hasMore = elements.length > 0 && nextCursor && nextCursor !== '';
  }

  console.log(`Se encontraron ${itemsDetails.length} publicaciones de productos en Walmart.`);

  let count = 0;

  // Phase B: Upsert to database
  for (const itemDetail of itemsDetails) {
    const sku = String(itemDetail.sku || '').trim().replace(/\s+/g, '');
    if (!sku) continue;

    const productDataToUpsert = {
      comercio: integration.comercio,
      platform: "Walmart",
      sku: sku,
      name: itemDetail.productName || 'Producto Walmart'
    };

    const { error: upsertErr } = await supabase
      .from("synced_products")
      .upsert(productDataToUpsert, { onConflict: "comercio,platform,sku" });

    if (upsertErr) {
      console.error(`Error al guardar producto Walmart SKU ${sku}:`, upsertErr.message);
    } else {
      count++;
    }
  }

  return count;
}

async function getValidAccessToken(integration: any): Promise<string | null> {
  const tokenUrl = 'https://marketplace.walmartapis.com/v3/token';

  const clientId = integration.client_id;
  const clientSecret = integration.client_secret;

  if (!clientId || !clientSecret) {
    console.error('❌ Error: Falta Client ID o Client Secret para la integración de Walmart.');
    return null;
  }

  // Refresh token flow
  if (integration.refresh_token) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integration.refresh_token
    });

    try {
      const basicAuth = btoa(`${clientId}:${clientSecret}`);
      const correlationId = crypto.randomUUID();

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'WM_MARKET': 'cl',
          'Accept': 'application/json'
        },
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
          refresh_token: data.refresh_token || integration.refresh_token
        })
        .eq('id', integration.id);

      return data.access_token;
    } catch (e) {
      console.error("Error al renovar token Walmart:", e.message);
    }
  }

  // Authorization code exchange
  if (integration.access_token && !integration.refresh_token && integration.access_token !== clientSecret && integration.access_token.length < 100) {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: integration.access_token,
      redirect_uri: integration.shop_url || 'https://www.google.com'
    });

    try {
      const basicAuth = btoa(`${clientId}:${clientSecret}`);
      const correlationId = crypto.randomUUID();

      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': correlationId,
          'WM_MARKET': 'cl',
          'Accept': 'application/json'
        },
        body: params.toString()
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Error en authorization_code flow Walmart: ${res.status} - ${errorText}`);
      }

      const data = await res.json();

      await supabase
        .from('merchant_integrations')
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token || null
        })
        .eq('id', integration.id);

      return data.access_token;
    } catch (e) {
      console.error(`❌ Error al intercambiar código Walmart:`, e.message);
      return null;
    }
  }

  // Client credentials flow
  const params = new URLSearchParams({
    grant_type: 'client_credentials'
  });

  try {
    const basicAuth = btoa(`${clientId}:${clientSecret}`);
    const correlationId = crypto.randomUUID();

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': correlationId,
        'WM_MARKET': 'cl',
        'Accept': 'application/json'
      },
      body: params.toString()
    });

    if (!res.ok) {
      throw new Error(`Client credentials failed: ${res.status}`);
    }

    const data = await res.json();
    
    await supabase
      .from('merchant_integrations')
      .update({
        access_token: data.access_token
      })
      .eq('id', integration.id);

    return data.access_token;
  } catch (e) {
    console.error("Error al obtener token Walmart por client_credentials:", e.message);
    return null;
  }
}
