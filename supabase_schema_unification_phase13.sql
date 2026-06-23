-- WMS STOCKA - Supabase Schema Phase 13: Restricciones de Unicidad para Prevenir Duplicados
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.
-- ¡IMPORTANTE!: Asegúrate de ejecutar primero el script de limpieza `clean_duplicates.js` para resolver los duplicados existentes, de lo contrario este script fallará.

-- 1. Restricción UNIQUE para asegurar un solo producto por SKU para cada Merchant/Cliente
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_merchant_id_sku_key;
ALTER TABLE public.products ADD CONSTRAINT products_merchant_id_sku_key UNIQUE (merchant_id, sku);

-- 2. Restricción UNIQUE para asegurar un solo pedido por número de orden y plataforma para cada Merchant/Cliente
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_merchant_id_platform_order_number_key;
ALTER TABLE public.orders ADD CONSTRAINT orders_merchant_id_platform_order_number_key UNIQUE (merchant_id, external_platform, external_order_number);
