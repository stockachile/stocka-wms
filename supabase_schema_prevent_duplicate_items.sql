-- WMS STOCKA - Supabase Schema: Consolidación Automática de Items de Pedidos y Packs (Prevención de Duplicados)
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql)

CREATE OR REPLACE FUNCTION public.expand_pack_order_items()
RETURNS trigger AS $$
DECLARE
  pack_member RECORD;
  is_product_pack BOOLEAN;
  v_existing_id UUID;
BEGIN
  -- Verificar si el producto que se está insertando es un pack
  SELECT is_pack INTO is_product_pack
  FROM public.products
  WHERE id = NEW.product_id;

  IF is_product_pack = TRUE THEN
    -- Si es un pack, buscar todos sus componentes
    FOR pack_member IN 
      SELECT member_product_id, quantity 
      FROM public.product_pack_items 
      WHERE pack_product_id = NEW.product_id
    LOOP
      -- Verificar si ya existe una fila para este componente en la orden y bodega
      SELECT id INTO v_existing_id
      FROM public.order_items
      WHERE order_id = NEW.order_id
        AND product_id = pack_member.member_product_id
        AND (warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id)
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        -- Si ya existe, sumar la cantidad requerida
        UPDATE public.order_items
        SET quantity = quantity + (NEW.quantity * pack_member.quantity)
        WHERE id = v_existing_id;
      ELSE
        -- Si no existe, insertar el componente
        INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity)
        VALUES (NEW.order_id, pack_member.member_product_id, NEW.warehouse_id, NEW.quantity * pack_member.quantity);
      END IF;
    END LOOP;

    -- Retornar NULL para cancelar la inserción del producto pack en sí
    RETURN NULL;
  END IF;

  -- Si no es un pack, verificar si ya existía una fila para el mismo producto en la orden para consolidar
  SELECT id INTO v_existing_id
  FROM public.order_items
  WHERE order_id = NEW.order_id
    AND product_id = NEW.product_id
    AND (warehouse_id IS NOT DISTINCT FROM NEW.warehouse_id)
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.order_items
    SET quantity = quantity + NEW.quantity
    WHERE id = v_existing_id;
    RETURN NULL;
  END IF;

  -- Proceder con la inserción normal
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-asociar el trigger a order_items
DROP TRIGGER IF EXISTS on_order_item_before_insert ON public.order_items;
CREATE TRIGGER on_order_item_before_insert
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE PROCEDURE public.expand_pack_order_items();
