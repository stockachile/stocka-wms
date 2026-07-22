const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

try {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      const val = trimmed.substring(idx + 1).trim();
      process.env[key] = val;
    }
  });
} catch (e) {
  console.warn('Advertencia: No se pudo leer el archivo .env:', e.message);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const sql = `
CREATE OR REPLACE FUNCTION public.validate_order_stock_before_dispatch()
RETURNS trigger AS $$
DECLARE
  item RECORD;
  v_available_qty INTEGER;
  v_insufficient BOOLEAN := FALSE;
  v_user_id UUID;
  v_missing_sku TEXT;
  v_missing_qty INTEGER;
  v_wh_name TEXT;
BEGIN
  -- 1. Si no pasa a 'despachado', no hacemos nada
  IF NEW.status != 'despachado' OR (OLD.status = 'despachado') THEN
    RETURN NEW;
  END IF;

  -- 2. Si no califica para procesar stock, no hacemos nada
  IF NOT public.should_process_order_stock(NEW.id) THEN
    RETURN NEW;
  END IF;

  -- 3. Verificar stock disponible para cada ítem del pedido
  FOR item IN 
    SELECT oi.*, p.sku, p.name AS prod_name, p.is_virtual, w.name AS wh_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN warehouses w ON w.id = oi.warehouse_id
    WHERE oi.order_id = NEW.id
  LOOP
    -- Si es virtual, no descontamos ni controlamos stock
    IF COALESCE(item.is_virtual, FALSE) THEN
      CONTINUE;
    END IF;

    -- Obtener cantidad física disponible en la bodega asignada
    SELECT COALESCE(quantity, 0) INTO v_available_qty
    FROM inventory
    WHERE product_id = item.product_id AND warehouse_id = item.warehouse_id;

    -- Si no hay suficiente stock físico
    IF v_available_qty < item.quantity THEN
      v_insufficient := TRUE;
      v_missing_sku := item.sku;
      v_missing_qty := item.quantity - v_available_qty;
      v_wh_name := item.wh_name;
      EXIT; -- Salimos del loop al detectar la primera insuficiencia
    END IF;
  END LOOP;

  -- 4. Si hay insuficiencia de stock, prevenimos el cambio a despachado, revertimos a "para procesar" y levantamos una incidencia
  IF v_insufficient THEN
    -- Revertimos el estado de la orden
    NEW.status := 'para procesar';
    NEW.estado_wms := 'En procesamiento';

    -- Buscar user_id del perfil para asociar la incidencia
    SELECT id INTO v_user_id FROM public.profiles WHERE comercio ILIKE '%' || NEW.comercio || '%' LIMIT 1;
    
    -- Insertar la incidencia crítica
    INSERT INTO public.incidencias (
      user_id,
      comercio,
      title,
      description,
      type,
      severity,
      status,
      solution
    ) VALUES (
      COALESCE(v_user_id, NEW.merchant_id),
      NEW.comercio,
      'Falta de stock crítico - Pedido ' || NEW.external_order_number,
      'El pedido ' || NEW.external_order_number || ' no se pudo despachar por falta de stock del SKU ' || v_missing_sku || ' en la bodega ' || v_wh_name || ' (Faltan ' || v_missing_qty || ' un.).',
      'stock',
      'critico',
      'pendiente',
      ''
    );

    -- Retornamos el NEW modificado
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_order_before_dispatch ON public.orders;
CREATE TRIGGER on_order_before_dispatch
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_order_stock_before_dispatch();
`;

async function apply() {
  console.log('=== APLICANDO TRIGGER POSTGRES EN SUPABASE ===\n');

  const { error } = await supabase.rpc('exec_sql', {
    sql: sql
  });

  if (error) {
    // Si execute_sql_query no existe o falla, podemos intentar ejecutarlo con sql_query_helper o similar
    console.error('Error usando rpc("execute_sql_query"):', error.message);
    console.log('Intentando ejecutar SQL a través de un script directo...');
  } else {
    console.log('✅ Trigger e insert de validación aplicados con éxito.');
  }
}

apply();
