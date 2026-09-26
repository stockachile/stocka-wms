-- WMS STOCKA - Supabase Schema Phase 28: Categoría de Entrega "LOGÍSTICA INVERSA"
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Actualizar la restricción de validación para la categoría de entrega en public.orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_categoria_entrega_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_categoria_entrega_check 
  CHECK (categoria_entrega IN ('RETIRO', 'DISTRIBUCIÓN', 'LOGÍSTICA INVERSA', 'LOGISTICA INVERSA'));

-- 2. Actualizar la función del trigger para la detección y asignación de categoría de entrega
CREATE OR REPLACE FUNCTION public.handle_order_delivery_category_rules()
RETURNS trigger AS $$
DECLARE
  v_has_keyword BOOLEAN := false;
  v_keyword RECORD;
BEGIN
  -- A) Operación de INSERT
  IF TG_OP = 'INSERT' THEN
    -- 1. Si el pedido proviene de Logística Inversa (por origen, plataforma, datos raw o prefijo LI-), asignar LOGÍSTICA INVERSA
    IF NEW.categoria_entrega IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA')
       OR NEW.origen = 'Logística Inversa' 
       OR NEW.external_platform = 'Logística Inversa' 
       OR (NEW.external_order_number IS NOT NULL AND NEW.external_order_number LIKE 'LI-%')
       OR (NEW.raw_shopify_data IS NOT NULL AND (NEW.raw_shopify_data->>'is_reverse_logistics')::boolean IS TRUE) THEN
      NEW.categoria_entrega := 'LOGÍSTICA INVERSA';
      
    -- 2. Si no viene especificada la categoría, o es 'DISTRIBUCIÓN' por defecto, evaluamos por el método de envío
    ELSIF NEW.categoria_entrega IS NULL OR NEW.categoria_entrega = 'DISTRIBUCIÓN' THEN
      IF NEW.shipping_method IS NOT NULL AND NEW.shipping_method <> '' THEN
        FOR v_keyword IN 
          SELECT value FROM public.wms_config_options WHERE type = 'keyword_retiro'
        LOOP
          IF LOWER(NEW.shipping_method) LIKE '%' || LOWER(v_keyword.value) || '%' THEN
            v_has_keyword := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_has_keyword THEN
        NEW.categoria_entrega := 'RETIRO';
      ELSE
        NEW.categoria_entrega := 'DISTRIBUCIÓN';
      END IF;
    END IF;

    -- Si la categoría de entrega es RETIRO, autocompletar agenda y operador si están vacíos
    IF NEW.categoria_entrega = 'RETIRO' THEN
      IF NEW.agenda IS NULL OR NEW.agenda = '' THEN
        NEW.agenda := 'RETIRO';
      END IF;
      IF NEW.operador IS NULL OR NEW.operador = '' OR NEW.operador = 'STARKEN' THEN
        NEW.operador := 'SUCURSAL ÑUÑOA';
      END IF;
    END IF;

  -- B) Operación de UPDATE
  ELSIF TG_OP = 'UPDATE' THEN
    -- Si se asigna explícitamente LOGÍSTICA INVERSA o se detecta que es de Logística Inversa
    IF NEW.categoria_entrega IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') THEN
      NEW.categoria_entrega := 'LOGÍSTICA INVERSA';
      IF NEW.agenda = 'RETIRO' THEN
        NEW.agenda := NULL;
      END IF;
      IF NEW.operador = 'SUCURSAL ÑUÑOA' THEN
        NEW.operador := NULL;
      END IF;

    -- Si cambia el shipping_method y la categoría actual es DISTRIBUCIÓN (y no es logística inversa), re-evaluar palabras clave
    ELSIF (NEW.shipping_method IS DISTINCT FROM OLD.shipping_method) AND (NEW.categoria_entrega = 'DISTRIBUCIÓN' OR NEW.categoria_entrega IS NULL) THEN
      IF NOT (NEW.origen = 'Logística Inversa' OR NEW.external_platform = 'Logística Inversa' OR (NEW.external_order_number IS NOT NULL AND NEW.external_order_number LIKE 'LI-%')) THEN
        IF NEW.shipping_method IS NOT NULL AND NEW.shipping_method <> '' THEN
          FOR v_keyword IN 
            SELECT value FROM public.wms_config_options WHERE type = 'keyword_retiro'
          LOOP
            IF LOWER(NEW.shipping_method) LIKE '%' || LOWER(v_keyword.value) || '%' THEN
              v_has_keyword := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF v_has_keyword THEN
          NEW.categoria_entrega := 'RETIRO';
        END IF;
      END IF;
    END IF;

    -- Si la categoría de entrega cambia a RETIRO, autocompletar
    IF NEW.categoria_entrega = 'RETIRO' AND (OLD.categoria_entrega IS DISTINCT FROM 'RETIRO') THEN
      NEW.agenda := 'RETIRO';
      NEW.operador := 'SUCURSAL ÑUÑOA';
      
    -- Si la categoría cambia de RETIRO a otra categoría, limpiar los valores autocompletados
    ELSIF NEW.categoria_entrega IN ('DISTRIBUCIÓN', 'LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') AND OLD.categoria_entrega = 'RETIRO' THEN
      IF NEW.agenda = 'RETIRO' THEN
        NEW.agenda := NULL;
      END IF;
      IF NEW.operador = 'SUCURSAL ÑUÑOA' THEN
        NEW.operador := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Actualizar pedidos históricos de Logística Inversa a su nueva categoría
UPDATE public.orders
SET categoria_entrega = 'LOGÍSTICA INVERSA',
    agenda = CASE WHEN agenda = 'RETIRO' THEN NULL ELSE agenda END,
    operador = CASE WHEN operador = 'SUCURSAL ÑUÑOA' THEN 'STOCKA' ELSE operador END
WHERE external_order_number LIKE 'LI-%' 
   OR origen = 'Logística Inversa' 
   OR external_platform = 'Logística Inversa'
   OR (raw_shopify_data IS NOT NULL AND (raw_shopify_data->>'is_reverse_logistics')::boolean IS TRUE);
