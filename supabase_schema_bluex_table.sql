-- WMS STOCKA - Supabase Schema: Integración Blue Express (app.bluex.cl)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Agregar columnas de Blue Express a la tabla de pedidos (orders)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS bluex_status TEXT,
ADD COLUMN IF NOT EXISTS raw_bluex_data JSONB;

-- Índice para acelerar búsquedas y filtros por estado de Blue Express en pedidos
CREATE INDEX IF NOT EXISTS idx_orders_bluex_status ON orders(bluex_status);

-- 2. Crear tabla dedicada para registro y auditoría de envíos Blue Express
CREATE TABLE IF NOT EXISTS bluex_envios (
  id TEXT PRIMARY KEY,                              -- Orden de Servicio (OS) de Blue Express
  tracking TEXT,                                    -- Número de seguimiento (igual a OS)
  tracking_url TEXT,                                -- URL de seguimiento unificado
  label_url TEXT,                                   -- URL de descarga de etiqueta PDF
  courier TEXT DEFAULT 'BLUEXPRESS',                -- Courier
  status TEXT,                                      -- Estado descriptivo / macroestado
  comercio TEXT,                                    -- Comercio resuelto en WMS
  pyme_name TEXT,                                   -- Nombre de la Pyme emisora en Blue Express
  nombre_destinatario TEXT,                         -- Nombre del destinatario
  telefono_destino TEXT,                            -- Teléfono del destinatario
  direccion_destino TEXT,                           -- Dirección de entrega
  comuna_destino TEXT,                              -- Comuna de destino
  region_destino TEXT,                              -- Región de destino
  valor_envio NUMERIC,                              -- Valor pagado / cotizado del envío
  medio_pago TEXT,                                  -- Medio de pago utilizado
  fecha_creacion_bluex TIMESTAMPTZ,                 -- Fecha de creación en Blue Express
  raw_data JSONB,                                   -- Payload crudo retornado por la API para auditoría
  created_at TIMESTAMPTZ DEFAULT now(),             -- Fecha de inserción en Supabase
  updated_at TIMESTAMPTZ DEFAULT now()              -- Fecha de actualización en Supabase
);

-- Índices de consulta rápida en la tabla bluex_envios
CREATE INDEX IF NOT EXISTS idx_bluex_envios_tracking ON bluex_envios(tracking);
CREATE INDEX IF NOT EXISTS idx_bluex_envios_status ON bluex_envios(status);
CREATE INDEX IF NOT EXISTS idx_bluex_envios_comercio ON bluex_envios(comercio);
CREATE INDEX IF NOT EXISTS idx_bluex_envios_fecha_creacion ON bluex_envios(fecha_creacion_bluex);

-- 3. Habilitar Row Level Security (RLS) y Políticas de Acceso
ALTER TABLE public.bluex_envios ENABLE ROW LEVEL SECURITY;

-- Asegurar función helper is_admin() si no existiera
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Eliminar políticas previas si existían
DROP POLICY IF EXISTS "Admin gestiona todo en bluex" ON public.bluex_envios;
DROP POLICY IF EXISTS "Clientes ven sus propios envios en bluex" ON public.bluex_envios;

-- Política para Administradores (Acceso Completo)
CREATE POLICY "Admin gestiona todo en bluex" ON public.bluex_envios
  FOR ALL USING (is_admin());

-- Política para Clientes (Solo lectura de los envíos de sus comercios asignados)
CREATE POLICY "Clientes ven sus propios envios en bluex" ON public.bluex_envios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(bluex_envios.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- Otorgar permisos a roles de Supabase
GRANT ALL ON public.bluex_envios TO postgres, service_role;
GRANT SELECT ON public.bluex_envios TO anon, authenticated;
