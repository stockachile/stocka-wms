-- =========================================================================
-- WMS STOCKA - Configuración y Seguimiento de Checklist de Onboarding
-- Ejecutar en Supabase SQL Editor si se desea habilitar la sincronización global en BD.
-- =========================================================================

-- 1. Asegurar columna JSONB onboarding_checklist en comercios_adicional_config
ALTER TABLE public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS onboarding_checklist JSONB DEFAULT '{
  "wms_account": true,
  "integrations": false,
  "catalog_ready": false,
  "shipping_configured": false,
  "stock_declared": false,
  "training_done": false,
  "dismissed": false
}'::jsonb;

-- 2. Tabla opcional para definición centralizada de puntos del checklist (para sincronización multi-admin)
CREATE TABLE IF NOT EXISTS public.onboarding_checklist_config (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    order_index INT NOT NULL DEFAULT 0,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Habilitar RLS
ALTER TABLE public.onboarding_checklist_config ENABLE ROW LEVEL SECURITY;

-- Permisos para roles
GRANT ALL ON public.onboarding_checklist_config TO postgres, service_role;
GRANT ALL ON public.onboarding_checklist_config TO anon, authenticated;

-- Políticas de RLS
DROP POLICY IF EXISTS "Todos pueden leer configuracion del checklist" ON public.onboarding_checklist_config;
CREATE POLICY "Todos pueden leer configuracion del checklist" ON public.onboarding_checklist_config
    FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins pueden gestionar configuracion del checklist" ON public.onboarding_checklist_config;
CREATE POLICY "Admins pueden gestionar configuracion del checklist" ON public.onboarding_checklist_config
    FOR ALL TO authenticated USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- 3. Cargar puntos iniciales predeterminados si la tabla está vacía
INSERT INTO public.onboarding_checklist_config (id, label, description, order_index, is_default)
VALUES 
    ('wms_account', 'Creación y Activación en WMS', 'Comercio creado en el sistema, sigla de 3 letras asignada y credenciales de usuario activas', 1, true),
    ('integrations', 'Integración de Canales de Venta', 'Canales vinculados (Shopify, Mercado Libre, Falabella, WooCommerce, etc.)', 2, true),
    ('catalog_ready', 'Carga y Homologación de Catálogo', 'Catálogo de productos cargado, SKUs homologados y dimensiones registradas', 3, true),
    ('shipping_configured', 'Configuración de Couriers y Envíos', 'ID de Envíame configurado, zonas de cobertura y bodegas habilitadas', 4, true),
    ('stock_declared', 'Recepción y Declaración de Stock Inicial', 'Inbound inicial recepcionado, contabilizado y almacenado en bodega', 5, true),
    ('training_done', 'Capacitación Operacional y KAM', 'Sesión de inducción operativa completada y KAM asignado al comercio', 6, true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.onboarding_checklist_config IS 'Definición de tareas y requisitos configurables para el checklist de onboarding de comercios.';
COMMENT ON COLUMN public.comercios_adicional_config.onboarding_checklist IS 'Estado y progreso del checklist de onboarding por cada comercio.';
