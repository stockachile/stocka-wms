-- WMS STOCKA - SQL Migration to propagate sucursal_pickeo changes to order_items
-- Run this script in the Supabase SQL Editor.

-- 1. Crear función para propagar cambios de sucursal a las bodegas de los ítems
CREATE OR REPLACE FUNCTION public.propagate_order_sucursal_change()
RETURNS trigger AS $$
DECLARE
  v_warehouse_id UUID;
BEGIN
  IF NEW.sucursal_pickeo IS DISTINCT FROM OLD.sucursal_pickeo OR TG_OP = 'INSERT' THEN
    IF NEW.sucursal_pickeo IS NOT NULL THEN
      IF LOWER(NEW.sucursal_pickeo) LIKE '%ñuñoa%' THEN
        v_warehouse_id := '973da888-8a63-4790-a08f-919e1af41a93'; -- Matriz Ñuñoa
      ELSIF LOWER(NEW.sucursal_pickeo) LIKE '%la reina%' THEN
        v_warehouse_id := '414605cb-f926-43d2-8bd2-d9509f7b458a'; -- CDD La Reina
      ELSIF LOWER(NEW.sucursal_pickeo) LIKE '%recoleta%' THEN
        v_warehouse_id := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a'; -- CDD Recoleta
      ELSE
        v_warehouse_id := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; -- Bodega Central
      END IF;
    ELSE
      v_warehouse_id := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; -- Bodega Central
    END IF;

    UPDATE public.order_items
    SET warehouse_id = v_warehouse_id
    WHERE order_id = NEW.id AND (warehouse_id IS DISTINCT FROM v_warehouse_id OR warehouse_id IS NULL);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Crear trigger sobre la tabla orders
DROP TRIGGER IF EXISTS on_order_sucursal_updated ON public.orders;
CREATE TRIGGER on_order_sucursal_updated
  AFTER UPDATE OF sucursal_pickeo OR INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.propagate_order_sucursal_change();

-- 3. Sanar cualquier pedido existente que tenga discordancia entre su sucursal_pickeo y la bodega de sus ítems
UPDATE public.order_items oi
SET warehouse_id = CASE 
  WHEN LOWER(o.sucursal_pickeo) LIKE '%ñuñoa%' THEN '973da888-8a63-4790-a08f-919e1af41a93'::uuid
  WHEN LOWER(o.sucursal_pickeo) LIKE '%la reina%' THEN '414605cb-f926-43d2-8bd2-d9509f7b458a'::uuid
  WHEN LOWER(o.sucursal_pickeo) LIKE '%recoleta%' THEN '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a'::uuid
  ELSE 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'::uuid
END
FROM public.orders o
WHERE oi.order_id = o.id 
  AND o.sucursal_pickeo IS NOT NULL 
  AND oi.warehouse_id IS DISTINCT FROM CASE 
    WHEN LOWER(o.sucursal_pickeo) LIKE '%ñuñoa%' THEN '973da888-8a63-4790-a08f-919e1af41a93'::uuid
    WHEN LOWER(o.sucursal_pickeo) LIKE '%la reina%' THEN '414605cb-f926-43d2-8bd2-d9509f7b458a'::uuid
    WHEN LOWER(o.sucursal_pickeo) LIKE '%recoleta%' THEN '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a'::uuid
    ELSE 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'::uuid
  END;
