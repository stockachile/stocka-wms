-- WMS STOCKA - Supabase Schema: Creación de tabla dedicada para LightData
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- Eliminamos la tabla previa para aplicar el nuevo diseño limpio de columnas
DROP TABLE IF EXISTS lightdata_envios CASCADE;

CREATE TABLE lightdata_envios (
  id TEXT PRIMARY KEY,                     -- ID (Interno) de LightData (did)
  empresa_comercio TEXT,                  -- Nombre Fantasia
  tracking TEXT,                           -- Número Tracking
  tracking_url TEXT,                       -- URL Tracking
  courier TEXT,                            -- Proveedor (Default: 'LightData')
  status TEXT,                             -- Estado actual en LightData
  servicio_tipo_envio TEXT,               -- Origen (ej: Directo, Flex)
  nombre_destinatario TEXT,                -- Nombre Destinatario
  telefono_destino TEXT,                   -- Tel. Destinatario
  email_cliente_destino TEXT,              -- Email Destinatario
  direccion_destino TEXT,                  -- Dirección
  complemento_destino TEXT,                -- Observaciones / Comentario Destino
  comuna_destino TEXT,                     -- Localidad
  raw_data JSONB,                          -- Guardado de la fila de excel completa para auditoría
  created_at TIMESTAMPTZ,                  -- Mapeado de 'Fecha AlphaGroup'
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para mejorar velocidad de búsqueda
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_tracking ON lightdata_envios(tracking);
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_status ON lightdata_envios(status);
