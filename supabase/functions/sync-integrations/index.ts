import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parse platform from request body early
    const { platform } = await req.json()

    // Verificar el rol del usuario
    const { data: profile, error: profErr } = await supabaseClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()

    if (profErr || !profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const isAdmin = profile.role === 'admin' || profile.role === 'all'
    let isAuthorized = isAdmin

    if (!isAuthorized && profile.role === 'client') {
      // Verificar si el cliente tiene una integración activa para esta plataforma
      const { data: integration, error: intErr } = await supabaseClient
        .from('merchant_integrations')
        .select('id')
        .eq('platform', platform)
        .eq('merchant_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

      if (!intErr && integration) {
        isAuthorized = true
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: 'Forbidden: Unauthorized for platform sync' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Mapear plataformas a sus respectivos workflows en GitHub Actions
    const workflowMap: Record<string, string> = {
      'MercadoLibre': 'sync_meli.yml',
      'WooCommerce': 'sync_woocommerce.yml',
      'Falabella': 'sync_falabella.yml',
      'Paris': 'sync_paris.yml',
      'LightData': 'sync_lightdata.yml',
      'Optiroute': 'optiroute_sync.yml',
      'Walmart': 'sync_walmart.yml'
    }

    const workflowFile = workflowMap[platform]
    if (!workflowFile) {
      return new Response(JSON.stringify({ error: `Manual sync not supported for platform: ${platform}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const githubPat = Deno.env.get('GITHUB_PAT')
    if (!githubPat) {
      return new Response(JSON.stringify({ error: 'Configuration error: GITHUB_PAT not set in Supabase Edge Functions' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Despachar ejecución del workflow en GitHub Actions
    console.log(`Triggering GitHub Action workflow: ${workflowFile} for platform ${platform}...`)
    const githubRes = await fetch(`https://api.github.com/repos/stockachile/stocka-wms/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Supabase-Edge-Function'
      },
      body: JSON.stringify({
        ref: 'main'
      })
    })

    if (!githubRes.ok) {
      const errText = await githubRes.text()
      return new Response(JSON.stringify({ error: `GitHub API error: ${githubRes.status} - ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ message: `Sincronización de ${platform} iniciada correctamente.` }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
