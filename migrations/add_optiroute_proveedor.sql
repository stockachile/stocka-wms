-- ==============================================================================
-- Migración: Configuración de Proveedor Oficial de Optiroute por Comercio
-- WMS STOCKA -> Optiroute
-- ==============================================================================

-- 1. Agregar columna optiroute_proveedor a comercios_adicional_config si no existe
ALTER TABLE IF EXISTS public.comercios_adicional_config 
ADD COLUMN IF NOT EXISTS optiroute_proveedor TEXT;

-- Comentario explicativo en la columna
COMMENT ON COLUMN public.comercios_adicional_config.optiroute_proveedor IS 
'Nombre exacto del proveedor registrado en el catálogo de Optiroute (45 proveedores oficiales). Si es NULL, se usa fallback a STOCKA.';

-- 2. Inicializar / Mapear los comercios activos a sus proveedores oficiales de Optiroute
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'ANLU STORE' WHERE UPPER(TRIM(comercio)) = 'ANLU STORE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'AQUALAT' WHERE UPPER(TRIM(comercio)) = 'AQUALAT';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'B4LIFE' WHERE UPPER(TRIM(comercio)) = 'B4LIFE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'CROMO' WHERE UPPER(TRIM(comercio)) = 'CROMO';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'DORMILONES' WHERE UPPER(TRIM(comercio)) = 'DORMILONES';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'EL MUNDO DEL CAFE' WHERE UPPER(TRIM(comercio)) = 'EL MUNDO DEL CAFE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'FORTE MAX' WHERE UPPER(TRIM(comercio)) = 'FORTE MAX';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'FRUTZ' WHERE UPPER(TRIM(comercio)) = 'FRUTZ';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'GLOSS' WHERE UPPER(TRIM(comercio)) = 'GLOSS';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'LIVROS' WHERE UPPER(TRIM(comercio)) = 'LIVROS';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'LUTAI' WHERE UPPER(TRIM(comercio)) = 'LUTAI';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'MAESE' WHERE UPPER(TRIM(comercio)) IN ('MAESE', 'MAESE LABS');
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'MAGIC MAKEUP' WHERE UPPER(TRIM(comercio)) = 'MAGIC MAKEUP';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'MEDSKILLS' WHERE UPPER(TRIM(comercio)) = 'MEDSKILLS';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'MENPRIME' WHERE UPPER(TRIM(comercio)) = 'MENPRIME';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'MUKAVA' WHERE UPPER(TRIM(comercio)) IN ('MUKAVA', 'MUKAVA CHILE');
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'NATIVA ELEMENTS' WHERE UPPER(TRIM(comercio)) = 'NATIVA ELEMENTS';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'NOMAD' WHERE UPPER(TRIM(comercio)) = 'NOMAD';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'OPARD' WHERE UPPER(TRIM(comercio)) = 'OPARD';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'POM KIDS' WHERE UPPER(TRIM(comercio)) = 'POM KIDS';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'RCT CHILE' WHERE UPPER(TRIM(comercio)) = 'RCT CHILE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'RELAJARTE' WHERE UPPER(TRIM(comercio)) = 'RELAJARTE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'SAGUAROSHOES' WHERE UPPER(TRIM(comercio)) = 'SAGUAROSHOES';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'SERPA' WHERE UPPER(TRIM(comercio)) = 'SERPA';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'SILVER FOX' WHERE UPPER(TRIM(comercio)) = 'SILVER FOX';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'SIMPLEMENTE CAFE' WHERE UPPER(TRIM(comercio)) = 'SIMPLEMENTE CAFE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'STREET GYM' WHERE UPPER(TRIM(comercio)) = 'STREET GYM';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'THE SKIN STORE' WHERE UPPER(TRIM(comercio)) = 'THE SKIN STORE';
UPDATE public.comercios_adicional_config SET optiroute_proveedor = 'VITALITYFOODS' WHERE UPPER(TRIM(comercio)) = 'VITALITYFOODS';

-- Para cualquier otro comercio sin proveedor específico, asignar por defecto 'STOCKA'
UPDATE public.comercios_adicional_config 
SET optiroute_proveedor = 'STOCKA' 
WHERE optiroute_proveedor IS NULL OR TRIM(optiroute_proveedor) = '';
