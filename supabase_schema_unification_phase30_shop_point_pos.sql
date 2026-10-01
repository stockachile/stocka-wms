-- =========================================================================
-- WMS STOCKA - Supabase Schema Phase 30: Categoría de Entrega "SHOP POINT (POS)"
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (WMS).
-- =========================================================================

-- 1. Actualizar la restricción de validación para la categoría de entrega en public.orders
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_categoria_entrega_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_categoria_entrega_check 
  CHECK (categoria_entrega IN ('RETIRO', 'DISTRIBUCIÓN', 'LOGÍSTICA INVERSA', 'LOGISTICA INVERSA', 'SHOP POINT (POS)', 'SHOP POINT', 'POS'));

-- 2. Actualizar la función del trigger para la detección y asignación de categoría de entrega
CREATE OR REPLACE FUNCTION public.handle_order_delivery_category_rules()
RETURNS trigger AS $$
DECLARE
  v_has_keyword BOOLEAN := false;
  v_keyword RECORD;
BEGIN
  -- A) Operación de INSERT
  IF TG_OP = 'INSERT' THEN
    -- 1. Si el pedido proviene de Punto de Venta (POS)
    IF NEW.categoria_entrega IN ('SHOP POINT (POS)', 'SHOP POINT', 'POS')
       OR NEW.origen IN ('Punto de Venta', 'POS', 'Shop Point', 'SHOP POINT (POS)') 
       OR NEW.external_platform IN ('Punto de Venta', 'POS', 'Shop Point', 'SHOP POINT (POS)')
       OR NEW.agenda = 'COMPRA EN BODEGA'
       OR (NEW.external_order_number IS NOT NULL AND (NEW.external_order_number LIKE 'POS-%' OR NEW.external_order_number LIKE 'VTA-%'))
       OR (NEW.raw_shopify_data IS NOT NULL AND (NEW.raw_shopify_data->>'is_pos_sale')::boolean IS TRUE) THEN
      NEW.categoria_entrega := 'SHOP POINT (POS)';
      IF NEW.agenda IS NULL OR NEW.agenda = '' OR NEW.agenda = 'POS' THEN
        NEW.agenda := 'COMPRA EN BODEGA';
      END IF;
      IF NEW.operador IS NULL OR NEW.operador = '' THEN
        NEW.operador := 'SUCURSAL ÑUÑOA';
      END IF;

    -- 2. Si el pedido proviene de Logística Inversa (por origen, plataforma, datos raw o prefijo LI-), asignar LOGÍSTICA INVERSA
    ELSIF NEW.categoria_entrega IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA')
       OR NEW.origen = 'Logística Inversa' 
       OR NEW.external_platform = 'Logística Inversa' 
       OR (NEW.external_order_number IS NOT NULL AND NEW.external_order_number LIKE 'LI-%')
       OR (NEW.raw_shopify_data IS NOT NULL AND (NEW.raw_shopify_data->>'is_reverse_logistics')::boolean IS TRUE) THEN
      NEW.categoria_entrega := 'LOGÍSTICA INVERSA';
      
    -- 3. Si no viene especificada la categoría, o es 'DISTRIBUCIÓN' por defecto, evaluamos por el método de envío
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
    -- Si se asigna explícitamente SHOP POINT (POS)
    IF NEW.categoria_entrega IN ('SHOP POINT (POS)', 'SHOP POINT', 'POS') THEN
      NEW.categoria_entrega := 'SHOP POINT (POS)';
      IF NEW.agenda IS NULL OR NEW.agenda = '' OR NEW.agenda = 'POS' THEN
        NEW.agenda := 'COMPRA EN BODEGA';
      END IF;
      IF NEW.operador IS NULL OR NEW.operador = '' THEN
        NEW.operador := 'SUCURSAL ÑUÑOA';
      END IF;

    -- Si se asigna explícitamente LOGÍSTICA INVERSA
    ELSIF NEW.categoria_entrega IN ('LOGÍSTICA INVERSA', 'LOGISTICA INVERSA') THEN
      NEW.categoria_entrega := 'LOGÍSTICA INVERSA';
      IF NEW.agenda = 'RETIRO' THEN
        NEW.agenda := NULL;
      END IF;
      IF NEW.operador = 'SUCURSAL ÑUÑOA' THEN
        NEW.operador := NULL;
      END IF;

    -- Si cambia el shipping_method y la categoría actual es DISTRIBUCIÓN
    ELSIF (NEW.shipping_method IS DISTINCT FROM OLD.shipping_method) AND (NEW.categoria_entrega = 'DISTRIBUCIÓN' OR NEW.categoria_entrega IS NULL) THEN
      IF NOT (NEW.origen = 'Logística Inversa' OR NEW.external_platform = 'Logística Inversa' OR (NEW.external_order_number IS NOT NULL AND NEW.external_order_number LIKE 'LI-%') OR NEW.origen = 'Punto de Venta' OR NEW.external_platform = 'Punto de Venta' OR NEW.agenda = 'COMPRA EN BODEGA') THEN
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
      
    -- Si la categoría cambia de RETIRO a otra categoría (que no sea SHOP POINT), limpiar los valores autocompletados
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

-- 3. Actualizar pedidos históricos de Punto de Venta a su nueva categoría
UPDATE public.orders
SET categoria_entrega = 'SHOP POINT (POS)',
    agenda = 'COMPRA EN BODEGA',
    operador = 'SUCURSAL ÑUÑOA'
WHERE origen = 'Punto de Venta'
   OR external_platform = 'Punto de Venta'
   OR agenda = 'COMPRA EN BODEGA'
   OR (raw_shopify_data IS NOT NULL AND (raw_shopify_data->>'is_pos_sale')::boolean IS TRUE)
   OR external_order_number LIKE 'POS-%'
   OR external_order_number LIKE 'TEST-POS-%';
