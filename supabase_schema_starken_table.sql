-- WMS STOCKA - Supabase Schema: Integración Starken Pro (starkenpro.cl)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Agregar columnas de Starken Pro a la tabla de pedidos (orders)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS starken_status TEXT,
ADD COLUMN IF NOT EXISTS raw_starken_data JSONB;

-- Índice para acelerar búsquedas y filtros por estado de Starken en pedidos
CREATE INDEX IF NOT EXISTS idx_orders_starken_status ON orders(starken_status);

-- 2. Crear tabla dedicada para registro y auditoría de envíos Starken Pro
CREATE TABLE IF NOT EXISTS starken_envios (
  id TEXT PRIMARY KEY,                              -- Orden de Flete (OF) de Starken
  tracking TEXT,                                    -- Número de seguimiento (OF)
  tracking_url TEXT,                                -- URL de seguimiento oficial
  label_url TEXT,                                   -- URL de etiqueta o identificador de impresión
  courier TEXT DEFAULT 'STARKEN',                   -- Courier
  status TEXT,                                      -- Estado descriptivo (ORIGEN, TRANSITO, DESTINO, REPARTO, ENTREGADOS, etc.)
  comercio TEXT,                                    -- Comercio resuelto en WMS
  pyme_name TEXT,                                   -- Nombre de cliente o razón social en Starken
  nombre_destinatario TEXT,                         -- Nombre del destinatario
  telefono_destino TEXT,                            -- Teléfono del destinatario
  direccion_destino TEXT,                           -- Dirección de entrega
  comuna_destino TEXT,                              -- Comuna de destino
  ciudad_destino TEXT,                              -- Ciudad de destino
  agencia_destino TEXT,                             -- Sucursal / Agencia destino si aplica
  tipo_servicio TEXT,                               -- Domicilio, Agencia, etc.
  valor_envio NUMERIC,                              -- Total tarifa / valor envío
  valor_declarado NUMERIC,                          -- Valor declarado
  numero_documento TEXT,                            -- Referencia de documento / pedido
  fecha_emision_starken TIMESTAMPTZ,                -- Fecha de emisión en Starken
  fecha_recepcion_starken TIMESTAMPTZ,              -- Fecha de recepción física
  fecha_compromiso TIMESTAMPTZ,                     -- Fecha compromiso de entrega
  raw_data JSONB,                                   -- Payload crudo retornado por la API para auditoría
  created_at TIMESTAMPTZ DEFAULT now(),             -- Fecha de inserción en Supabase
  updated_at TIMESTAMPTZ DEFAULT now()              -- Fecha de actualización en Supabase
);

-- Índices de consulta rápida en la tabla starken_envios
CREATE INDEX IF NOT EXISTS idx_starken_envios_tracking ON starken_envios(tracking);
CREATE INDEX IF NOT EXISTS idx_starken_envios_status ON starken_envios(status);
CREATE INDEX IF NOT EXISTS idx_starken_envios_comercio ON starken_envios(comercio);
CREATE INDEX IF NOT EXISTS idx_starken_envios_fecha_emision ON starken_envios(fecha_emision_starken);
CREATE INDEX IF NOT EXISTS idx_starken_envios_num_doc ON starken_envios(numero_documento);

-- 3. Habilitar Row Level Security (RLS) y Políticas de Acceso
ALTER TABLE public.starken_envios ENABLE ROW LEVEL SECURITY;

-- Asegurar función helper is_admin() si no existiera
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Eliminar políticas previas si existían
DROP POLICY IF EXISTS "Admin gestiona todo en starken" ON public.starken_envios;
DROP POLICY IF EXISTS "Clientes ven sus propios envios en starken" ON public.starken_envios;

-- Política para Administradores (Acceso Completo)
CREATE POLICY "Admin gestiona todo en starken" ON public.starken_envios
  FOR ALL USING (is_admin());

-- Política para Clientes (Solo lectura de los envíos de sus comercios asignados)
CREATE POLICY "Clientes ven sus propios envios en starken" ON public.starken_envios
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND (
          LOWER(profiles.comercio) = 'all'
          OR LOWER(starken_envios.comercio) = ANY (
            SELECT TRIM(LOWER(token))
            FROM unnest(string_to_array(profiles.comercio, ',')) AS token
          )
        )
    )
  );

-- Otorgar permisos a roles de Supabase
GRANT ALL ON public.starken_envios TO postgres, service_role;
GRANT SELECT ON public.starken_envios TO anon, authenticated;
