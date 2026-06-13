-- WMS STOCKA - Supabase Schema: Creación de tabla dedicada para LightData
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- Eliminamos la tabla previa para aplicar el nuevo diseño limpio de columnas
DROP TABLE IF EXISTS lightdata_envios CASCADE;

CREATE TABLE lightdata_envios (
  id TEXT PRIMARY KEY,                              -- ID (Interno) de LightData (did)
  empresa_comercio TEXT,                           -- Nombre Fantasia
  tracking TEXT,                                    -- Número Tracking
  tracking_url TEXT,                                -- URL Tracking
  courier TEXT,                                     -- Proveedor (ej: 'CARRIER EXTERNO')
  status TEXT,                                      -- Estado actual en LightData
  servicio_tipo_envio TEXT,                        -- Tipo de Envío (ej: 'SAME DAY/24 HRS')
  nombre_destinatario TEXT,                         -- Nombre Destinatario
  telefono_destino TEXT,                            -- Tel. Destinatario
  email_cliente_destino TEXT,                       -- Email Destinatario
  direccion_destino TEXT,                           -- Dirección
  complemento_destino TEXT,                         -- Observaciones / Comentario Destino
  comuna_destino TEXT,                              -- Localidad
  fecha_creacion_lightdata TIMESTAMPTZ,             -- Fecha de creación en LightData (Fecha AlphaGroup)
  fecha_actualizacion_lightdata TIMESTAMPTZ,          -- Fecha de última actualización en LightData (Fecha estado)
  fecha_venta TEXT,                                 -- Fecha venta original
  raw_data JSONB,                                   -- Guardado de la fila de excel completa para auditoría
  created_at TIMESTAMPTZ DEFAULT now(),             -- Control de creación en base de datos (Supabase)
  updated_at TIMESTAMPTZ DEFAULT now()              -- Control de última actualización en base de datos (Supabase)
);

-- Índices para mejorar velocidad de búsqueda
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_tracking ON lightdata_envios(tracking);
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_status ON lightdata_envios(status);
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_fecha_creacion ON lightdata_envios(fecha_creacion_lightdata);
