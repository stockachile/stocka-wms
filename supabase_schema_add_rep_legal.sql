-- =========================================================================
-- MIGRACIÓN: AÑADIR DATOS DE REPRESENTANTE LEGAL A ONBOARDING Y CONFIG COMERCIOS
-- =========================================================================

-- 1. Agregar columnas a public.onboarding_requests
ALTER TABLE public.onboarding_requests ADD COLUMN IF NOT EXISTS rep_legal_nombre TEXT;
ALTER TABLE public.onboarding_requests ADD COLUMN IF NOT EXISTS rep_legal_rut TEXT;
ALTER TABLE public.onboarding_requests ADD COLUMN IF NOT EXISTS rep_legal_telefono TEXT;
ALTER TABLE public.onboarding_requests ADD COLUMN IF NOT EXISTS rep_legal_email TEXT;

-- 2. Agregar columnas a public.comercios_adicional_config
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS rep_legal_nombre TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS rep_legal_rut TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS rep_legal_telefono TEXT;
ALTER TABLE public.comercios_adicional_config ADD COLUMN IF NOT EXISTS rep_legal_email TEXT;

-- 3. Recrear la función create_onboarding_request para soportar los nuevos parámetros
-- Primero eliminamos la versión antigua (sin representante legal) para evitar conflictos de sobrecarga
DROP FUNCTION IF EXISTS public.create_onboarding_request(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[], TEXT[], TEXT[], BOOLEAN, TEXT, TEXT, TEXT
);

-- Recrear el cuerpo completo de create_onboarding_request
CREATE OR REPLACE FUNCTION public.create_onboarding_request(
    p_user_id UUID,
    p_full_name TEXT,
    p_rut_personal TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_cargo TEXT,
    p_razon_social TEXT,
    p_rut_empresa TEXT,
    p_giro_comercio TEXT,
    p_direccion_facturacion TEXT,
    p_comuna TEXT,
    p_email_facturacion TEXT,
    p_nombre_fantasia TEXT,
    p_sitio_web TEXT,
    p_plataformas_venta TEXT[],
    p_marketplaces TEXT[],
    p_courier_santiago TEXT[],
    p_courier_regiones TEXT[],
    p_ml_opciones TEXT[],
    p_retiro_sucursal BOOLEAN,
    p_descripcion_packaging TEXT,
    p_contrato_url TEXT,
    p_contrato_storage_path TEXT,
    p_rep_legal_nombre TEXT DEFAULT NULL,
    p_rep_legal_rut TEXT DEFAULT NULL,
    p_rep_legal_telefono TEXT DEFAULT NULL,
    p_rep_legal_email TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_request_id UUID;
    v_status TEXT;
BEGIN
    -- Si no se envía url del contrato, queda en 'pending_contract' (esperando firma privada)
    IF (p_contrato_url IS NULL OR p_contrato_url = '') THEN
        v_status := 'pending_contract';
    ELSE
        v_status := 'pending';
    END IF;

    INSERT INTO public.onboarding_requests (
        user_id, full_name, rut_personal, email, phone, cargo,
        razon_social, rut_empresa, giro_comercio, direccion_facturacion, comuna, email_facturacion,
        nombre_fantasia, sitio_web, plataformas_venta, marketplaces,
        courier_santiago, courier_regiones, ml_opciones, retiro_sucursal, descripcion_packaging,
        contrato_url, contrato_storage_path, status,
        rep_legal_nombre, rep_legal_rut, rep_legal_telefono, rep_legal_email
    )
    VALUES (
        p_user_id, p_full_name, p_rut_personal, p_email, p_phone, p_cargo,
        p_razon_social, p_rut_empresa, p_giro_comercio, p_direccion_facturacion, p_comuna, p_email_facturacion,
        p_nombre_fantasia, p_sitio_web, p_plataformas_venta, p_marketplaces,
        p_courier_santiago, p_courier_regiones, p_ml_opciones, p_retiro_sucursal, p_descripcion_packaging,
        p_contrato_url, p_contrato_storage_path, v_status,
        p_rep_legal_nombre, p_rep_legal_rut, p_rep_legal_telefono, p_rep_legal_email
    )
    RETURNING id INTO v_request_id;
    
    RETURN v_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Otorgar permiso de ejecución al público
GRANT EXECUTE ON FUNCTION public.create_onboarding_request TO anon, authenticated;
