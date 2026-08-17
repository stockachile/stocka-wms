-- WMS STOCKA - SQL Migration to support default warehouse per commerce
-- Run this script in the Supabase SQL Editor.

-- 1. Agregar columna default_warehouse_id a comercios_adicional_config
ALTER TABLE public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS default_warehouse_id UUID REFERENCES public.warehouses(id);

-- 2. Modificar la función assign_default_warehouse para contemplar la configuración del comercio
CREATE OR REPLACE FUNCTION public.assign_default_warehouse()
RETURNS trigger AS $$
DECLARE
  v_default_warehouse_id UUID := 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'; -- Bodega Central
  v_sucursal TEXT;
  v_comercio TEXT;
  v_comercio_default_wh UUID;
  v_resolved_wh UUID;
BEGIN
  IF NEW.warehouse_id IS NULL THEN
    -- 1. Obtener la sucursal de pickeo y el comercio del pedido
    SELECT sucursal_pickeo, comercio INTO v_sucursal, v_comercio 
    FROM public.orders 
    WHERE id = NEW.order_id;
    
    -- 2. Intentar resolver por sucursal_pickeo primero
    IF v_sucursal IS NOT NULL THEN
      IF LOWER(v_sucursal) LIKE '%ñuñoa%' THEN
        v_resolved_wh := '973da888-8a63-4790-a08f-919e1af41a93'; -- Matriz Ñuñoa
      ELSIF LOWER(v_sucursal) LIKE '%la reina%' THEN
        v_resolved_wh := '414605cb-f926-43d2-8bd2-d9509f7b458a'; -- CDD La Reina
      ELSIF LOWER(v_sucursal) LIKE '%recoleta%' THEN
        v_resolved_wh := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a'; -- CDD Recoleta
      END IF;
    END IF;
    
    -- 3. Si no se resolvió por sucursal, intentar resolver por la configuración por defecto del comercio
    IF v_resolved_wh IS NULL AND v_comercio IS NOT NULL THEN
      SELECT default_warehouse_id INTO v_comercio_default_wh 
      FROM public.comercios_adicional_config 
      WHERE comercio = v_comercio;
      
      IF v_comercio_default_wh IS NOT NULL THEN
        v_resolved_wh := v_comercio_default_wh;
      END IF;
    END IF;
    
    -- 4. Si aún no se resolvió, usar Bodega Central por defecto
    IF v_resolved_wh IS NULL THEN
      v_resolved_wh := v_default_warehouse_id;
    END IF;
    
    NEW.warehouse_id := v_resolved_wh;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Modificar la función propagate_order_sucursal_change para contemplar la configuración del comercio
CREATE OR REPLACE FUNCTION public.propagate_order_sucursal_change()
RETURNS trigger AS $$
DECLARE
  v_warehouse_id UUID;
  v_comercio_default_wh UUID;
BEGIN
  IF NEW.sucursal_pickeo IS DISTINCT FROM OLD.sucursal_pickeo OR TG_OP = 'INSERT' THEN
    IF NEW.sucursal_pickeo IS NOT NULL AND NEW.sucursal_pickeo <> '' THEN
      IF LOWER(NEW.sucursal_pickeo) LIKE '%ñuñoa%' THEN
        v_warehouse_id := '973da888-8a63-4790-a08f-919e1af41a93'; -- Matriz Ñuñoa
      ELSIF LOWER(NEW.sucursal_pickeo) LIKE '%la reina%' THEN
        v_warehouse_id := '414605cb-f926-43d2-8bd2-d9509f7b458a'; -- CDD La Reina
      ELSIF LOWER(NEW.sucursal_pickeo) LIKE '%recoleta%' THEN
        v_warehouse_id := '1e3395fc-bc24-48e5-8c3c-04e8a0f7c32a'; -- CDD Recoleta
      ELSE
        -- Sucursal Virtual o desconocida: buscar default del comercio
        SELECT default_warehouse_id INTO v_comercio_default_wh 
        FROM public.comercios_adicional_config 
        WHERE comercio = NEW.comercio;
        
        v_warehouse_id := COALESCE(v_comercio_default_wh, 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'); -- Bodega Central fallback
      END IF;
    ELSE
      -- Sin sucursal: buscar default del comercio
      SELECT default_warehouse_id INTO v_comercio_default_wh 
      FROM public.comercios_adicional_config 
      WHERE comercio = NEW.comercio;
      
      v_warehouse_id := COALESCE(v_comercio_default_wh, 'ae3ee613-0c36-4ee7-8d7d-2a3ec49dfe09'); -- Bodega Central fallback
    END IF;

    UPDATE public.order_items
    SET warehouse_id = v_warehouse_id
    WHERE order_id = NEW.id AND (warehouse_id IS DISTINCT FROM v_warehouse_id OR warehouse_id IS NULL);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
