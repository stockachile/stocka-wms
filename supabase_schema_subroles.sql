-- ========================================================================
-- WMS STOCKA - Esquema para Sub-roles y Plantillas de Permisos
-- ========================================================================

-- 1. Crear tabla para almacenar sub-roles y plantillas de permisos personalizadas
CREATE TABLE IF NOT EXISTS public.wms_sub_roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('client', 'admin', 'observer')),
    description TEXT,
    allowed_modules TEXT NOT NULL, -- Lista de IDs de módulos separados por comas o 'all'
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Habilitar RLS en wms_sub_roles
ALTER TABLE public.wms_sub_roles ENABLE ROW LEVEL SECURITY;

-- Política de lectura para usuarios autenticados
DROP POLICY IF EXISTS "Lectura de sub-roles para usuarios autenticados" ON public.wms_sub_roles;
CREATE POLICY "Lectura de sub-roles para usuarios autenticados"
ON public.wms_sub_roles FOR SELECT
TO authenticated
USING (true);

-- Política de administración para administradores
DROP POLICY IF EXISTS "Gestion total de sub-roles para administradores" ON public.wms_sub_roles;
CREATE POLICY "Gestion total de sub-roles para administradores"
ON public.wms_sub_roles FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
);

-- 2. Agregar columna sub_role a la tabla profiles si no existe
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sub_role TEXT;

-- 3. Insertar sub-roles iniciales por defecto si la tabla está vacía
INSERT INTO public.wms_sub_roles (id, name, role, description, allowed_modules, is_system)
VALUES 
    (
        'cliente_p1', 
        'Cliente P1 (Básico / Operaciones Clave)', 
        'client', 
        'Acceso esencial a inventario, catálogo, pedidos, despachos e ingresos.', 
        'dashboard, inventory, catalog, declarations, orders, shipments, movements, tickets, documentation, profile', 
        true
    ),
    (
        'cliente_p2', 
        'Cliente P2 (Operaciones Avanzadas & Envíos)', 
        'client', 
        'Operación ampliada con manifiestos, etiquetas, volumen diario y cotizador.', 
        'dashboard, inventory, catalog, label_generator, volumen_diario, declarations, orders, shipments, manifests, movements, warehouses, pending, returns, cotizador, tickets, documentation, inbox, profile', 
        true
    ),
    (
        'cliente_p3', 
        'Cliente P3 (Full Servicios & Comercial)', 
        'client', 
        'Acceso total a todos los módulos y servicios del portal de clientes.', 
        'all', 
        true
    ),
    (
        'cliente_consulta', 
        'Cliente Consulta (Solo Lectura)', 
        'client', 
        'Acceso restringido para visualización de catálogo, stock y trazabilidad.', 
        'dashboard, inventory, catalog, movements, documentation, profile', 
        true
    ),
    (
        'admin_p1', 
        'Admin P1 (Supervisor Operativo)', 
        'admin', 
        'Gestión diaria de pedidos, despachos, inventario y reclamos.', 
        'orders_admin, cotizador_admin, consolidated_shipments, manifests_admin, incidencias_admin, volumen_diario_admin, returns_admin, pos_admin, inventory_admin, movements_admin, reassign_admin, catalog, label_generator, declarations_admin, notifications_admin', 
        true
    ),
    (
        'admin_p2', 
        'Admin P2 (Administrador Total)', 
        'admin', 
        'Control y administración completa de todas las áreas del sistema WMS.', 
        'all', 
        true
    ),
    (
        'admin_comercial', 
        'Admin Comercial / KAM', 
        'admin', 
        'Enfocado en clientes, onboarding, cotizaciones y facturación.', 
        'merchants_admin, onboarding_admin, leads_admin, redzone_admin, pricing_config_admin, billing_admin, clickup_facturacion_admin, enviame_analytics, surveys_admin, documentation_admin', 
        true
    )
ON CONFLICT (id) DO NOTHING;
