-- WMS STOCKA - Esquema de Facturación y Cobranza (Versión 3)
-- Ejecutar en el SQL Editor de Supabase

-- 1. Crear Tabla de Mapeos de Facturación (Agrupación de Comercios)
CREATE TABLE IF NOT EXISTS public.billing_mappings (
    comercio_nombre TEXT PRIMARY KEY, -- Nombre original en comercios_config (ej: 'BACK IN TIME')
    billing_name TEXT NOT NULL,       -- Nombre agrupado para facturación (ej: 'BIG BANG')
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Insertar mapeos iniciales para el cliente BIG BANG
INSERT INTO public.billing_mappings (comercio_nombre, billing_name) VALUES
('BACK IN TIME', 'BIG BANG'),
('DORMILONES', 'BIG BANG'),
('RELAJARTE', 'BIG BANG')
ON CONFLICT (comercio_nombre) DO UPDATE SET billing_name = EXCLUDED.billing_name;

-- 2. Crear Tabla de Estado del Servicio (Al día / Pausado)
CREATE TABLE IF NOT EXISTS public.commerce_billing_status (
    comercio TEXT PRIMARY KEY,
    al_dia BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 3. Crear la Tabla de Periodos de Facturación
CREATE TABLE IF NOT EXISTS public.billing_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE, -- Ej: "MAYO 2026"
    period_month INTEGER CHECK (period_month BETWEEN 1 AND 12),
    period_year INTEGER,
    status TEXT NOT NULL CHECK (status IN ('activo', 'en_proceso', 'proximo')) DEFAULT 'proximo',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Asegurar columnas si se corre sobre base de datos existente
ALTER TABLE public.billing_periods ADD COLUMN IF NOT EXISTS period_month INTEGER CHECK (period_month BETWEEN 1 AND 12);
ALTER TABLE public.billing_periods ADD COLUMN IF NOT EXISTS period_year INTEGER;

-- Seteo por defecto de registros existentes basados en el nombre
UPDATE public.billing_periods
SET period_year = CAST(split_part(name, ' ', 2) AS INTEGER),
    period_month = CASE split_part(name, ' ', 1)
        WHEN 'ENERO' THEN 1
        WHEN 'FEBRERO' THEN 2
        WHEN 'MARZO' THEN 3
        WHEN 'ABRIL' THEN 4
        WHEN 'MAYO' THEN 5
        WHEN 'JUNIO' THEN 6
        WHEN 'JULIO' THEN 7
        WHEN 'AGOSTO' THEN 8
        WHEN 'SEPTIEMBRE' THEN 9
        WHEN 'OCTUBRE' THEN 10
        WHEN 'NOVIEMBRE' THEN 11
        WHEN 'DICIEMBRE' THEN 12
        ELSE 1
    END
WHERE period_month IS NULL;

-- 4. Crear la Tabla de Registros de Facturación por Comercio
CREATE TABLE IF NOT EXISTS public.billing_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id UUID NOT NULL REFERENCES public.billing_periods(id) ON DELETE CASCADE,
    comercio TEXT NOT NULL, -- Nombre del comercio de facturación (ej: 'BIG BANG' o 'MARINA VITAL')
    fecha_limite DATE,
    fecha_limite_enviame DATE,
    
    -- Campos de Fulfillment
    desglose_fulfillment TEXT DEFAULT 'Por Generar' CHECK (desglose_fulfillment IN ('Enviado', 'Aprobado', 'Creado', 'Por Generar', 'Sin movimientos')),
    total_fulfillment INTEGER DEFAULT 0,
    abono_fulfillment INTEGER DEFAULT 0,
    pago_fulfillment TEXT DEFAULT 'Por solicitar' CHECK (pago_fulfillment IN ('Recibido', 'En espera', 'Atrasado', 'abono', 'aprobado', 'incobrable', 'Por solicitar', 'Sin movimientos')),
    factura_fulfillment TEXT DEFAULT 'Esperando' CHECK (factura_fulfillment IN ('No se factura', 'Emitida', 'Facturar', 'Esperando', 'Sin movimientos')),
    num_factura INTEGER,
    
    -- Campos de Enviame
    enviame INTEGER DEFAULT 0,
    abono_enviame INTEGER DEFAULT 0,
    pago_enviame TEXT DEFAULT 'Por solicitar' CHECK (pago_enviame IN ('Recibido', 'En espera', 'Atrasado', 'abono', 'aprobado', 'incobrable', 'Por solicitar', 'Sin movimientos')),
    factura_enviame TEXT DEFAULT 'Esperando' CHECK (factura_enviame IN ('No se factura', 'Emitida', 'Facturar', 'Esperando', 'Sin movimientos')),
    num_factura_enviame INTEGER,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
    
    -- Un comercio de facturación solo puede tener un registro por mes
    UNIQUE (period_id, comercio)
);

-- Asegurar la existencia de la nueva columna en caso de que la tabla ya exista
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS fecha_limite_enviame DATE;


-- 5. Crear la Tabla de Reportes de Pagos (Enviados por Clientes)
CREATE TABLE IF NOT EXISTS public.payment_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_id UUID NOT NULL REFERENCES public.billing_periods(id) ON DELETE CASCADE,
    comercio TEXT NOT NULL,
    monto INTEGER NOT NULL,
    fecha_pago DATE NOT NULL,
    servicio TEXT NOT NULL CHECK (servicio IN ('fulfillment', 'enviame', 'ambos')),
    comprobante_url TEXT, -- URL pública del archivo en Supabase Storage
    status TEXT NOT NULL CHECK (status IN ('pendiente', 'aprobado', 'rechazado')) DEFAULT 'pendiente',
    motivo_rechazo TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.billing_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commerce_billing_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reports ENABLE ROW LEVEL SECURITY;

-- 6. Crear Políticas de Seguridad RLS

-- Mapeos
DROP POLICY IF EXISTS "Admins gestionan mapeos" ON public.billing_mappings;
CREATE POLICY "Admins gestionan mapeos" ON public.billing_mappings FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Usuarios ven mapeos" ON public.billing_mappings;
CREATE POLICY "Usuarios ven mapeos" ON public.billing_mappings FOR SELECT USING (auth.role() = 'authenticated');

-- Estados de Comercio
DROP POLICY IF EXISTS "Admins gestionan estados de servicio" ON public.commerce_billing_status;
CREATE POLICY "Admins gestionan estados de servicio" ON public.commerce_billing_status FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Usuarios ven estados de servicio" ON public.commerce_billing_status;
CREATE POLICY "Usuarios ven estados de servicio" ON public.commerce_billing_status FOR SELECT USING (auth.role() = 'authenticated');

-- Periodos
DROP POLICY IF EXISTS "Admins gestionan periodos" ON public.billing_periods;
CREATE POLICY "Admins gestionan periodos" ON public.billing_periods FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Usuarios ven periodos" ON public.billing_periods;
CREATE POLICY "Usuarios ven periodos" ON public.billing_periods FOR SELECT USING (auth.role() = 'authenticated');

-- Registros de Facturación
DROP POLICY IF EXISTS "Admins gestionan registros de facturacion" ON public.billing_records;
CREATE POLICY "Admins gestionan registros de facturacion" ON public.billing_records FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Clientes ven facturacion de sus comercios autorizados" ON public.billing_records;
CREATE POLICY "Clientes ven facturacion de sus comercios autorizados" ON public.billing_records FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.role = 'admin'
            OR p.comercio = 'all'
            OR public.billing_records.comercio = ANY (
                 ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
            )
            OR EXISTS (
                 SELECT 1 FROM public.billing_mappings bg
                 WHERE bg.billing_name = public.billing_records.comercio
                   AND bg.comercio_nombre = ANY (
                        ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                   )
            )
          )
    )
);

-- Reportes de Pago
DROP POLICY IF EXISTS "Admins gestionan reportes de pago" ON public.payment_reports;
CREATE POLICY "Admins gestionan reportes de pago" ON public.payment_reports FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
);
DROP POLICY IF EXISTS "Clientes crean reportes de pago" ON public.payment_reports;
CREATE POLICY "Clientes crean reportes de pago" ON public.payment_reports FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.comercio = 'all'
            OR payment_reports.comercio = ANY (
                 ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
            )
            OR EXISTS (
                 SELECT 1 FROM public.billing_mappings bg
                 WHERE bg.billing_name = payment_reports.comercio
                   AND bg.comercio_nombre = ANY (
                        ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                   )
            )
          )
    )
);
DROP POLICY IF EXISTS "Clientes ven sus propios reportes de pago" ON public.payment_reports;
CREATE POLICY "Clientes ven sus propios reportes de pago" ON public.payment_reports FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.role = 'admin'
            OR p.comercio = 'all'
            OR payment_reports.comercio = ANY (
                 ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
            )
            OR EXISTS (
                 SELECT 1 FROM public.billing_mappings bg
                 WHERE bg.billing_name = payment_reports.comercio
                   AND bg.comercio_nombre = ANY (
                        ARRAY(SELECT trim(name) FROM unnest(string_to_array(p.comercio, ',')) AS name)
                   )
            )
          )
    )
);

-- 7. Funciones RPC y Procedimientos de Negocio

-- A) Actualizar pagos atrasados por fecha vencida
CREATE OR REPLACE FUNCTION public.check_overdue_payments()
RETURNS void AS $$
DECLARE
    r_record RECORD;
    r_user RECORD;
    v_msg TEXT;
    v_title TEXT;
BEGIN
    -- Vencimiento de Fulfillment
    UPDATE public.billing_records
    SET pago_fulfillment = 'Atrasado'
    WHERE fecha_limite < CURRENT_DATE
      AND pago_fulfillment NOT IN ('Recibido', 'abono', 'aprobado', 'Atrasado', 'Sin movimientos');

    -- Vencimiento de Envíame
    UPDATE public.billing_records
    SET pago_enviame = 'Atrasado'
    WHERE fecha_limite_enviame < CURRENT_DATE
      AND pago_enviame NOT IN ('Recibido', 'abono', 'aprobado', 'Atrasado', 'Sin movimientos');

    -- Generar notificaciones diarias para registros con pagos atrasados
    FOR r_record IN
        SELECT id, comercio, pago_fulfillment, pago_enviame
        FROM public.billing_records
        WHERE pago_fulfillment = 'Atrasado' OR pago_enviame = 'Atrasado'
    LOOP
        -- Construir el mensaje según el servicio atrasado
        IF r_record.pago_fulfillment = 'Atrasado' AND r_record.pago_enviame = 'Atrasado' THEN
            v_title := 'Servicios Fulfillment y Envíame Atrasados - ' || r_record.comercio;
            v_msg := 'Tus pagos de Fulfillment y Envíame se encuentran atrasados. Por favor regularizar a la brevedad para evitar la pausa de los servicios. Contáctanos a finanzas@stocka.cl.';
        ELSIF r_record.pago_fulfillment = 'Atrasado' THEN
            v_title := 'Servicio Fulfillment Atrasado - ' || r_record.comercio;
            v_msg := 'Tu pago de Fulfillment se encuentra atrasado. Por favor regularizar a la brevedad para evitar la pausa del servicio. Contáctanos a finanzas@stocka.cl.';
        ELSE
            v_title := 'Servicio Envíame Atrasado - ' || r_record.comercio;
            v_msg := 'Tu pago de Envíame se encuentra atrasado. Por favor regularizar a la brevedad para evitar la pausa del servicio. Contáctanos a finanzas@stocka.cl.';
        END IF;

        -- Buscar los usuarios asociados a este comercio
        FOR r_user IN
            SELECT id FROM public.profiles
            WHERE role = 'client'
              AND (
                comercio = 'all'
                OR r_record.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                OR EXISTS (
                    SELECT 1 FROM public.billing_mappings bg
                    WHERE bg.billing_name = r_record.comercio
                      AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                )
              )
        LOOP
            -- Insertar sólo si no se ha notificado hoy para este comercio y usuario
            IF NOT EXISTS (
                SELECT 1 FROM public.dashboard_notifications
                WHERE user_id = r_user.id
                  AND title = v_title
                  AND created_at::date = CURRENT_DATE
            ) THEN
                INSERT INTO public.dashboard_notifications (
                    user_id, target_role, title, message, is_read, created_at
                ) VALUES (
                    r_user.id, 'client', v_title, v_msg, false, timezone('utc'::text, now())
                );
            END IF;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- B) Limpieza automática de comprobantes de pago de más de 7 días
CREATE OR REPLACE FUNCTION public.clean_old_receipts()
RETURNS void AS $$
BEGIN
    DELETE FROM storage.objects
    WHERE bucket_id = 'payment_receipts'
      AND created_at < (NOW() - INTERVAL '7 days');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- C) Modificar la política SELECT de dashboard_notifications para no mostrar alertas programadas a futuro
DROP POLICY IF EXISTS "Usuarios ven sus notificaciones o las generales" ON public.dashboard_notifications;
CREATE POLICY "Usuarios ven sus notificaciones o las generales" ON public.dashboard_notifications
  FOR SELECT USING (
    (
      user_id = auth.uid() OR 
      (user_id IS NULL AND (target_role = 'all' OR target_role = (SELECT role FROM public.profiles WHERE id = auth.uid()))) OR
      (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    )
    AND created_at <= timezone('utc'::text, now())
  );

-- 8. Triggers de Automatizaciones y Notificaciones

-- A) Autocompletar abonos en base a cambio de estado (BEFORE UPDATE)
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_before_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Autocompletar abono de Fulfillment si se marca como Recibido
    IF (NEW.pago_fulfillment = 'Recibido' AND OLD.pago_fulfillment IS DISTINCT FROM 'Recibido') THEN
        NEW.abono_fulfillment := NEW.total_fulfillment;
    END IF;
    
    -- Autocompletar abono de Envíame si se marca como Recibido
    IF (NEW.pago_enviame = 'Recibido' AND OLD.pago_enviame IS DISTINCT FROM 'Recibido') THEN
        NEW.abono_enviame := NEW.enviame;
    END IF;

    -- Si se cambia de estado Recibido a otro, y el abono es igual al total, resetear a 0 por comodidad
    IF (NEW.pago_fulfillment IS DISTINCT FROM 'Recibido' AND OLD.pago_fulfillment = 'Recibido' AND NEW.abono_fulfillment = NEW.total_fulfillment) THEN
        NEW.abono_fulfillment := 0;
    END IF;
    IF (NEW.pago_enviame IS DISTINCT FROM 'Recibido' AND OLD.pago_enviame = 'Recibido' AND NEW.abono_enviame = NEW.enviame) THEN
        NEW.abono_enviame := 0;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_billing_record_before_update ON public.billing_records;
CREATE TRIGGER tr_billing_record_before_update
    BEFORE UPDATE ON public.billing_records
    FOR EACH ROW
    EXECUTE FUNCTION public.tr_fn_billing_record_before_update();

-- B) Notificaciones agendadas y por estados (AFTER INSERT/UPDATE)

-- Trigger al insertar registro: Notificar desglose disponible en 1 hora
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_after_insert()
RETURNS TRIGGER AS $$
DECLARE
    r_user RECORD;
BEGIN
    -- Enviar solo si el desglose está en estado 'Enviado' y el pago en estado 'En espera'
    IF (NEW.desglose_fulfillment = 'Enviado' AND NEW.pago_fulfillment = 'En espera') THEN
        FOR r_user IN 
            SELECT id FROM public.profiles 
            WHERE role = 'client' 
              AND (
                comercio = 'all'
                OR NEW.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                OR EXISTS (
                    SELECT 1 FROM public.billing_mappings bg
                    WHERE bg.billing_name = NEW.comercio
                      AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                )
              )
        LOOP
            INSERT INTO public.dashboard_notifications (
                user_id, target_role, title, message, is_read, created_at
            ) VALUES (
                r_user.id, 'client', 'Desglose de servicios listo - ' || NEW.comercio,
                'Se ha emitido un nuevo desglose de servicios para el periodo actual. Estará disponible para su revisión completa en breve.',
                false, timezone('utc'::text, now() + interval '1 hour')
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_billing_record_inserted ON public.billing_records;
CREATE TRIGGER tr_billing_record_inserted
    AFTER INSERT ON public.billing_records
    FOR EACH ROW
    EXECUTE FUNCTION public.tr_fn_billing_record_after_insert();

-- Trigger al actualizar registro: Alertas de atraso y recordatorios de vencimiento agendados
CREATE OR REPLACE FUNCTION public.tr_fn_billing_record_after_update()
RETURNS TRIGGER AS $$
DECLARE
    r_user RECORD;
    v_notif_title_fulf TEXT;
    v_notif_title_env TEXT;
BEGIN
    v_notif_title_fulf := 'Vencimiento de pago Fulfillment - ' || NEW.comercio;
    v_notif_title_env := 'Vencimiento de pago Envíame - ' || NEW.comercio;

    -- 1. Si el pago de Fulfillment cambia a 'Atrasado', alertar inmediatamente
    IF (NEW.pago_fulfillment = 'Atrasado' AND OLD.pago_fulfillment IS DISTINCT FROM 'Atrasado') THEN
        FOR r_user IN 
            SELECT id FROM public.profiles 
            WHERE role = 'client' 
              AND (
                comercio = 'all'
                OR NEW.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                OR EXISTS (
                    SELECT 1 FROM public.billing_mappings bg
                    WHERE bg.billing_name = NEW.comercio
                      AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                )
              )
        LOOP
            INSERT INTO public.dashboard_notifications (
                user_id, target_role, title, message, is_read, created_at
            ) VALUES (
                r_user.id, 'client', 'Pago de Fulfillment Atrasado - ' || NEW.comercio,
                'Te informamos que tu pago de Fulfillment se encuentra atrasado. Por favor, regulariza el pago lo antes posible para evitar interrupciones en el servicio.',
                false, timezone('utc'::text, now())
            );
        END LOOP;
    END IF;

    -- 2. Si el pago de Envíame cambia a 'Atrasado', alertar inmediatamente
    IF (NEW.pago_enviame = 'Atrasado' AND OLD.pago_enviame IS DISTINCT FROM 'Atrasado') THEN
        FOR r_user IN 
            SELECT id FROM public.profiles 
            WHERE role = 'client' 
              AND (
                comercio = 'all'
                OR NEW.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                OR EXISTS (
                    SELECT 1 FROM public.billing_mappings bg
                    WHERE bg.billing_name = NEW.comercio
                      AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                )
              )
        LOOP
            INSERT INTO public.dashboard_notifications (
                user_id, target_role, title, message, is_read, created_at
            ) VALUES (
                r_user.id, 'client', 'Pago de Envíame Atrasado - ' || NEW.comercio,
                'Te informamos que tu pago de Envíame se encuentra atrasado. Por favor, regulariza el pago lo antes posible para evitar interrupciones en el servicio.',
                false, timezone('utc'::text, now())
            );
        END LOOP;
    END IF;

    -- 3. Gestionar recordatorios de fecha límite para Fulfillment
    IF (NEW.fecha_limite IS DISTINCT FROM OLD.fecha_limite OR NEW.pago_fulfillment IS DISTINCT FROM OLD.pago_fulfillment) THEN
        -- Eliminar recordatorios anteriores no leídos de este tipo
        DELETE FROM public.dashboard_notifications
        WHERE title = v_notif_title_fulf AND is_read = false;

        -- Si la fecha límite está definida y el pago NO está recibido/abonado/aprobado, programar alerta de vencimiento
        IF (NEW.fecha_limite IS NOT NULL AND NEW.pago_fulfillment NOT IN ('Recibido', 'abono', 'aprobado', 'Sin movimientos')) THEN
            FOR r_user IN 
                SELECT id FROM public.profiles 
                WHERE role = 'client' 
                  AND (
                    comercio = 'all'
                    OR NEW.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                    OR EXISTS (
                        SELECT 1 FROM public.billing_mappings bg
                        WHERE bg.billing_name = NEW.comercio
                          AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                    )
                  )
            LOOP
                INSERT INTO public.dashboard_notifications (
                    user_id, target_role, title, message, is_read, created_at
                ) VALUES (
                    r_user.id, 'client', v_notif_title_fulf,
                    'Hoy vence el plazo de pago para el servicio de Fulfillment. Recuerda que exceder los límites de pago puede significar la pausa del servicio.',
                    false, timezone('utc', NEW.fecha_limite + time '08:00:00')
                );
            END LOOP;
        END IF;
    END IF;

    -- 4. Gestionar recordatorios de fecha límite para Envíame
    IF (NEW.fecha_limite_enviame IS DISTINCT FROM OLD.fecha_limite_enviame OR NEW.pago_enviame IS DISTINCT FROM OLD.pago_enviame) THEN
        -- Eliminar recordatorios anteriores no leídos de este tipo
        DELETE FROM public.dashboard_notifications
        WHERE title = v_notif_title_env AND is_read = false;

        -- Si la fecha límite de Envíame está definida y el pago NO está recibido/abonado/aprobado, programar alerta de vencimiento
        IF (NEW.fecha_limite_enviame IS NOT NULL AND NEW.pago_enviame NOT IN ('Recibido', 'abono', 'aprobado', 'Sin movimientos')) THEN
            FOR r_user IN 
                SELECT id FROM public.profiles 
                WHERE role = 'client' 
                  AND (
                    comercio = 'all'
                    OR NEW.comercio = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                    OR EXISTS (
                        SELECT 1 FROM public.billing_mappings bg
                        WHERE bg.billing_name = NEW.comercio
                          AND bg.comercio_nombre = ANY (ARRAY(SELECT trim(name) FROM unnest(string_to_array(comercio, ',')) AS name))
                    )
                  )
            LOOP
                INSERT INTO public.dashboard_notifications (
                    user_id, target_role, title, message, is_read, created_at
                ) VALUES (
                    r_user.id, 'client', v_notif_title_env,
                    'Hoy vence el plazo de pago para el servicio de Envíame. Recuerda que exceder los límites de pago puede significar la pausa del servicio.',
                    false, timezone('utc', NEW.fecha_limite_enviame + time '08:00:00')
                );
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_billing_record_updated ON public.billing_records;
CREATE TRIGGER tr_billing_record_updated
    AFTER UPDATE ON public.billing_records
    FOR EACH ROW
    EXECUTE FUNCTION public.tr_fn_billing_record_after_update();

-- Otorgar permisos sobre las tablas
GRANT ALL ON public.billing_mappings TO postgres, service_role;
GRANT SELECT ON public.billing_mappings TO anon, authenticated;

GRANT ALL ON public.commerce_billing_status TO postgres, service_role;
GRANT ALL ON public.commerce_billing_status TO anon, authenticated;

GRANT ALL ON public.billing_periods TO postgres, service_role;
GRANT SELECT ON public.billing_periods TO anon, authenticated;

GRANT ALL ON public.billing_records TO postgres, service_role;
GRANT ALL ON public.billing_records TO anon, authenticated;

GRANT ALL ON public.payment_reports TO postgres, service_role;
GRANT ALL ON public.payment_reports TO anon, authenticated;

-- 9. Políticas de Almacenamiento (Supabase Storage) para la carpeta de comprobantes de pago
-- Asegurar que el bucket existe y es público para lectura
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment_receipts', 'payment_receipts', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Permitir a usuarios autenticados subir archivos al bucket 'payment_receipts'
DROP POLICY IF EXISTS "Permitir subir comprobantes a usuarios autenticados" ON storage.objects;
CREATE POLICY "Permitir subir comprobantes a usuarios autenticados" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'payment_receipts');

-- Permitir a cualquier usuario ver/descargar los comprobantes del bucket 'payment_receipts'
DROP POLICY IF EXISTS "Permitir ver comprobantes a cualquiera" ON storage.objects;
CREATE POLICY "Permitir ver comprobantes a cualquiera" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'payment_receipts');

-- Permitir a administradores borrar o modificar objetos en el bucket 'payment_receipts'
DROP POLICY IF EXISTS "Admins gestionan todos los objetos de almacenamiento" ON storage.objects;
CREATE POLICY "Admins gestionan todos los objetos de almacenamiento" ON storage.objects
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );
