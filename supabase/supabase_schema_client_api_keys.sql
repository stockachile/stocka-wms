-- ==============================================================================
-- WMS STOCKA - GESTIÓN DE API KEYS PARA CLIENTES CON SISTEMA PROPIO (FLORACTIVE)
-- ==============================================================================

-- 1. Tabla para almacenar API Keys y Webhooks de clientes externos
CREATE TABLE IF NOT EXISTS public.client_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  comercio TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  webhook_url TEXT,
  webhook_secret TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- 2. Habilitar Row Level Security (RLS)
ALTER TABLE public.client_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins y Service Role gestionan API keys" ON public.client_api_keys;
CREATE POLICY "Admins y Service Role gestionan API keys" ON public.client_api_keys
  FOR ALL USING (auth.role() = 'service_role');

-- 3. Registro inicial de Floractive
INSERT INTO public.client_api_keys (merchant_id, comercio, api_key)
VALUES (
  '2a27e3bf-a505-4c82-aef0-e3fc81b2a1e3',
  'FLORACTIVE',
  'stk_live_floractive_8a92f03b4e112d'
) ON CONFLICT (api_key) DO NOTHING;

-- 4. Índice para búsquedas ultrarrápidas de autenticación
CREATE INDEX IF NOT EXISTS idx_client_api_keys_lookup ON public.client_api_keys (api_key, is_active);
