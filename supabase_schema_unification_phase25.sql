-- WMS STOCKA - Supabase Schema Phase 25: Integración de Pedidos con Retiro
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Agregar la columna de categoría de entrega a la tabla orders si no existe
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS categoria_entrega TEXT DEFAULT 'DISTRIBUCIÓN';

-- 2. Agregar la restricción de validación para la categoría de entrega
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_categoria_entrega_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_categoria_entrega_check CHECK (categoria_entrega IN ('RETIRO', 'DISTRIBUCIÓN'));

-- 3. Asegurar que la tabla wms_config_options exista con su unicidad
CREATE TABLE IF NOT EXISTS public.wms_config_options (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (type, value)
);

-- Eliminar registros duplicados si existen antes de añadir la restricción
DELETE FROM public.wms_config_options a
USING public.wms_config_options b
WHERE a.id > b.id
  AND a.type = b.type
  AND a.value = b.value;

-- Añadir la restricción única explícitamente en caso de que la tabla ya existiera previamente
ALTER TABLE public.wms_config_options DROP CONSTRAINT IF EXISTS wms_config_options_type_value_key;
ALTER TABLE public.wms_config_options ADD CONSTRAINT wms_config_options_type_value_key UNIQUE (type, value);

-- Eliminar la restricción UNIQUE restrictiva sobre la columna 'value' que impide tener el mismo valor en tipos distintos
ALTER TABLE public.wms_config_options DROP CONSTRAINT IF EXISTS wms_config_options_value_key;

-- Actualizar la restricción CHECK para permitir el tipo 'keyword_retiro' además de 'agenda' y 'operador'
ALTER TABLE public.wms_config_options DROP CONSTRAINT IF EXISTS wms_config_options_type_check;
ALTER TABLE public.wms_config_options ADD CONSTRAINT wms_config_options_type_check CHECK (type IN ('agenda', 'operador', 'keyword_retiro'));

-- 4. Insertar palabras clave por defecto para identificar retiros
INSERT INTO public.wms_config_options (type, value) VALUES
  ('keyword_retiro', 'RETIRO'),
  ('keyword_retiro', 'CENTRO'),
  ('keyword_retiro', 'SUCURSAL')
ON CONFLICT (type, value) DO NOTHING;

-- 5. Crear la función del trigger para la detección y autocompletado de la categoría de entrega
CREATE OR REPLACE FUNCTION public.handle_order_delivery_category_rules()
RETURNS trigger AS $$
DECLARE
  v_has_keyword BOOLEAN := false;
  v_keyword RECORD;
BEGIN
  -- A) Operación de INSERT
  IF TG_OP = 'INSERT' THEN
    -- Si no viene especificada la categoría, o es 'DISTRIBUCIÓN' por defecto, evaluamos por el método de envío
    IF NEW.categoria_entrega IS NULL OR NEW.categoria_entrega = 'DISTRIBUCIÓN' THEN
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
    -- Si cambia el shipping_method y la categoría actual es DISTRIBUCIÓN, re-evaluar palabras clave
    IF (NEW.shipping_method IS DISTINCT FROM OLD.shipping_method) AND (NEW.categoria_entrega = 'DISTRIBUCIÓN' OR NEW.categoria_entrega IS NULL) THEN
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

    -- Si la categoría de entrega cambia a RETIRO, autocompletar
    IF NEW.categoria_entrega = 'RETIRO' AND (OLD.categoria_entrega IS DISTINCT FROM 'RETIRO') THEN
      NEW.agenda := 'RETIRO';
      NEW.operador := 'SUCURSAL ÑUÑOA';
      
    -- Si la categoría cambia de RETIRO a DISTRIBUCIÓN, limpiar los valores autocompletados
    ELSIF NEW.categoria_entrega = 'DISTRIBUCIÓN' AND OLD.categoria_entrega = 'RETIRO' THEN
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

-- 6. Crear el trigger en la tabla orders
DROP TRIGGER IF EXISTS trg_order_delivery_category ON public.orders;
CREATE TRIGGER trg_order_delivery_category
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.handle_order_delivery_category_rules();

-- 7. Migración retrospectiva: Actualizar pedidos existentes
UPDATE public.orders
SET categoria_entrega = 'RETIRO',
    agenda = 'RETIRO',
    operador = 'SUCURSAL ÑUÑOA'
WHERE (categoria_entrega IS NULL OR categoria_entrega = 'DISTRIBUCIÓN')
  AND (
    LOWER(shipping_method) LIKE '%retiro%'
    OR LOWER(shipping_method) LIKE '%centro%'
    OR LOWER(shipping_method) LIKE '%sucursal%'
  );

-- 8. Habilitar RLS en la tabla wms_config_options si no lo está, y configurar sus políticas de acceso para clientes autenticados
ALTER TABLE public.wms_config_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura a usuarios autenticados" ON public.wms_config_options;
CREATE POLICY "Permitir lectura a usuarios autenticados" ON public.wms_config_options
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Permitir insercion a usuarios autenticados" ON public.wms_config_options;
CREATE POLICY "Permitir insercion a usuarios autenticados" ON public.wms_config_options
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Permitir eliminacion a usuarios autenticados" ON public.wms_config_options;
CREATE POLICY "Permitir eliminacion a usuarios autenticados" ON public.wms_config_options
  FOR DELETE USING (auth.role() = 'authenticated');
