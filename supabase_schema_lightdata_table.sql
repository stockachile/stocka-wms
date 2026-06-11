-- WMS STOCKA - Supabase Schema: Creación de tabla dedicada para LightData
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

CREATE TABLE IF NOT EXISTS lightdata_envios (
  id TEXT PRIMARY KEY,                    -- El 'did' único del envío en LightData (extraído de data-qr)
  nombre_fantasia TEXT,                   -- Nombre fantasia (ej: Stocka 1)
  idml TEXT,                              -- ID de MercadoLibre / Referencia interna
  origen TEXT,                            -- Origen (ej: Directo, Flex, Shopify)
  tracking_number TEXT,                   -- Número de seguimiento
  fecha_venta TEXT,                       -- Fecha de venta reportada
  fecha_alphagroup TEXT,                  -- Fecha de ingreso a LightData
  destino_nombre TEXT,                    -- Nombre del destinatario
  comuna TEXT,                            -- Comuna de destino
  zona_entrega TEXT,                      -- Zona de entrega
  zona_costo TEXT,                        -- Zona de costo / Tarifa aplicada
  estado TEXT,                            -- Estado actual en LightData (ej: A retirar, Entregado)
  raw_data JSONB,                         -- Payload JSON completo del registro scraped
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para mejorar velocidad de búsqueda
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_tracking ON lightdata_envios(tracking_number);
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_idml ON lightdata_envios(idml);
CREATE INDEX IF NOT EXISTS idx_lightdata_envios_estado ON lightdata_envios(estado);
