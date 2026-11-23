-- WMS STOCKA - Preferencias granulares de correos automáticos por contacto y comercio
-- Fecha: 2026-11-27
-- Permite configurar por cada contacto/usuario de un comercio qué categorías de correos automáticos recibe:
--   billing        : Facturación y Cobranza (desgloses, facturas DTE, recordatorios, atrasos, pagos, pausas/reactivaciones)
--   inbounds       : Ingresos de Stock (creación, asignación/cambio de bodega, recepción, confirmación/incidencias)
--   inventory      : Toma de Inventario Físico (solicitudes, aclaraciones, aceptación, cierre)
--   alerts         : Alertas Operacionales y Reportes (stock agotado/crítico, pedido sin stock, incidencias, volumen, reportes)
--   communications : Comunicados y Novedades Masivas de Stocka

ALTER TABLE public.billing_contacts
  ADD COLUMN IF NOT EXISTS email_preferences JSONB NOT NULL DEFAULT '{
    "billing": true,
    "inbounds": true,
    "inventory": true,
    "alerts": true,
    "communications": true
  }'::jsonb;

-- Asegurar que registros existentes tengan todas las claves inicializadas (retrocompatibilidad 100%)
UPDATE public.billing_contacts
SET email_preferences = jsonb_build_object(
  'billing', COALESCE((email_preferences->>'billing')::boolean, true),
  'inbounds', COALESCE((email_preferences->>'inbounds')::boolean, true),
  'inventory', COALESCE((email_preferences->>'inventory')::boolean, true),
  'alerts', COALESCE((email_preferences->>'alerts')::boolean, true),
  'communications', COALESCE((email_preferences->>'communications')::boolean, true)
)
WHERE email_preferences IS NULL
   OR NOT (
     email_preferences ? 'billing'
     AND email_preferences ? 'inbounds'
     AND email_preferences ? 'inventory'
     AND email_preferences ? 'alerts'
     AND email_preferences ? 'communications'
   );

CREATE INDEX IF NOT EXISTS idx_billing_contacts_comercio_lower
  ON public.billing_contacts (lower(trim(comercio)));

COMMENT ON COLUMN public.billing_contacts.email_preferences IS
  'Preferencias granulares de correos automáticos por categoría: billing, inbounds, inventory, alerts, communications';
