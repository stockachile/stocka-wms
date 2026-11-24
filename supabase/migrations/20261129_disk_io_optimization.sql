-- =========================================================================================
-- WMS STOCKA - Optimización de Disk IO Budget
-- Fecha: 2026-11-23
-- 1. Índice funcional para evitar escaneos completos en raw_shopify_data->>'id' (sync_shopify.js)
-- 2. Reducir frecuencia de process_billing_email_queue() de cada 1 min a cada 5 min
-- =========================================================================================

-- 1. Índice parcial funcional en public.orders para búsqueda por Shopify order ID
CREATE INDEX IF NOT EXISTS idx_orders_comercio_raw_shopify_id
  ON public.orders (comercio, ((raw_shopify_data->>'id')))
  WHERE raw_shopify_data IS NOT NULL
    AND (raw_shopify_data->>'id') IS NOT NULL;

ANALYZE public.orders;

-- 2. Bajar frecuencia del cron de process_billing_email_queue() de cada 1 min a cada 5 min
DO $$
DECLARE
  v_job RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR v_job IN
      SELECT jobid, jobname, schedule, command
      FROM cron.job
      WHERE command ILIKE '%process_billing_email_queue%'
        AND schedule = '* * * * *'
    LOOP
      PERFORM cron.alter_job(v_job.jobid, schedule := '*/5 * * * *');
      RAISE NOTICE 'Updated cron job % (%) schedule to */5 * * * *', v_job.jobname, v_job.jobid;
    END LOOP;
  END IF;
END $$;
