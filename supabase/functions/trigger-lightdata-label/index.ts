import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Manejo de peticiones preflight (CORS)
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

    // Validar sesión del usuario
    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(token)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Parsear cuerpo de la petición
    const { orderId, mode, limit } = await req.json()

    // Validar perfil del usuario
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

    const githubPat = Deno.env.get('GITHUB_PAT')
    if (!githubPat) {
      return new Response(JSON.stringify({ error: 'Configuration error: GITHUB_PAT not set in Supabase Edge Functions' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const workflowFile = 'create_lightdata_labels.yml'
    
    console.log(`Triggering GitHub Action workflow: ${workflowFile} for mode ${mode || 'individual'}...`)
    
    // Ejecutar trigger en GitHub Actions con los inputs correspondientes
    const githubRes = await fetch(`https://api.github.com/repos/stockachile/stocka-wms/actions/workflows/${workflowFile}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubPat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Supabase-Edge-Function'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          mode: mode || 'individual',
          orderId: orderId || '',
          limit: String(limit || '10')
        }
      })
    })

    if (!githubRes.ok) {
      const errText = await githubRes.text()
      return new Response(JSON.stringify({ error: `GitHub API error: ${githubRes.status} - ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ message: `Generación de etiqueta iniciada en GitHub Actions.` }), {
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
