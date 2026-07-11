-- WMS STOCKA - Supabase Schema for Packs and Bundles

-- 1. Añadir columna is_pack a la tabla products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_pack BOOLEAN DEFAULT FALSE;

-- 2. Crear tabla de componentes de packs
CREATE TABLE IF NOT EXISTS public.product_pack_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pack_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  member_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(pack_product_id, member_product_id),
  CONSTRAINT no_self_reference CHECK (pack_product_id <> member_product_id)
);

-- Habilitar RLS en product_pack_items
ALTER TABLE public.product_pack_items ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas RLS para product_pack_items
DROP POLICY IF EXISTS "Clientes ven componentes de sus propios packs" ON public.product_pack_items;
CREATE POLICY "Clientes ven componentes de sus propios packs" ON public.product_pack_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id = product_pack_items.pack_product_id
    )
  );

DROP POLICY IF EXISTS "Clientes gestionan componentes de sus propios packs" ON public.product_pack_items;
CREATE POLICY "Clientes gestionan componentes de sus propios packs" ON public.product_pack_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.products
      WHERE products.id = product_pack_items.pack_product_id
        AND products.merchant_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin gestiona todos los componentes de packs" ON public.product_pack_items;
CREATE POLICY "Admin gestiona todos los componentes de packs" ON public.product_pack_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- 4. Crear trigger para expansión de packs en order_items
CREATE OR REPLACE FUNCTION public.expand_pack_order_items()
RETURNS trigger AS $$
DECLARE
  pack_member RECORD;
  is_product_pack BOOLEAN;
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
      -- Insertar cada componente como un item de orden independiente
      -- con la cantidad escalada (cantidad de la orden * cantidad en el pack)
      INSERT INTO public.order_items (order_id, product_id, warehouse_id, quantity)
      VALUES (NEW.order_id, pack_member.member_product_id, NEW.warehouse_id, NEW.quantity * pack_member.quantity);
    END LOOP;

    -- Retornar NULL para cancelar la inserción del producto pack en sí
    RETURN NULL;
  END IF;

  -- Si no es un pack, proceder con la inserción normal
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Asociar el trigger BEFORE INSERT a order_items
DROP TRIGGER IF EXISTS on_order_item_before_insert ON public.order_items;
CREATE TRIGGER on_order_item_before_insert
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE PROCEDURE public.expand_pack_order_items();
