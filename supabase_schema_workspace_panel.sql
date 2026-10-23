-- =================================================================================
-- WMS STOCKA - Esquema de Base de Datos: Módulo "Mi Panel de Trabajo" (Workspace)
-- =================================================================================
-- Incluye:
-- 1. user_workspace_settings : Preferencias por usuario, teléfono WhatsApp Stox,
--                              herramientas seleccionadas en el botón flotante y Scratchpad.
-- 2. user_workspace_tasks    : Tareas, checklist diario ("Mi Día"), rutinas recurrentes,
--                              sub-tareas, estado Kanban y recordatorios por WhatsApp (Stox).
-- 3. user_workspace_notes    : Notas personales, post-its por colores, etiquetas y fijados.
--
-- Ejecutar en el Editor SQL de Supabase:
-- https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new
-- =================================================================================

-- 1. Tabla de Configuración del Panel y Botón Flotante por Usuario
CREATE TABLE IF NOT EXISTS public.user_workspace_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    whatsapp_phone TEXT DEFAULT NULL,
    whatsapp_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    daily_digest_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    daily_digest_time TEXT NOT NULL DEFAULT '08:30',
    last_digest_sent_date TEXT DEFAULT NULL,
    floating_btn_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    floating_tools JSONB NOT NULL DEFAULT '["checklist", "scratchpad", "stox"]'::jsonb,
    auto_rollover_tasks BOOLEAN NOT NULL DEFAULT TRUE,
    scratchpad_content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Tabla de Tareas, Checklist Diario y Recordatorios Stox
CREATE TABLE IF NOT EXISTS public.user_workspace_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completed_at TIMESTAMPTZ DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'waiting', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    category TEXT NOT NULL DEFAULT 'operaciones',
    target_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_at TIMESTAMPTZ DEFAULT NULL,
    recurrence TEXT NOT NULL DEFAULT 'none'
        CHECK (recurrence IN ('none', 'daily_workdays', 'daily', 'weekly', 'monthly')),
    last_recurrence_date TEXT DEFAULT NULL,
    subtasks JSONB NOT NULL DEFAULT '[]'::jsonb,
    linked_type TEXT DEFAULT NULL, -- 'order', 'sku', 'merchant', 'ticket'
    linked_ref TEXT DEFAULT NULL,
    reminder_at TIMESTAMPTZ DEFAULT NULL,
    reminder_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent_at TIMESTAMPTZ DEFAULT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. Tabla de Notas Personales y Tarjetas Fijadas
CREATE TABLE IF NOT EXISTS public.user_workspace_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT 'default'
        CHECK (color IN ('default', 'amber', 'blue', 'emerald', 'purple', 'rose')),
    tags TEXT[] NOT NULL DEFAULT '{}',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_at TIMESTAMPTZ DEFAULT NULL,
    reminder_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
    reminder_sent_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 4. Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_workspace_tasks_user_date
    ON public.user_workspace_tasks(user_id, target_date, is_completed);

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_user_status
    ON public.user_workspace_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_workspace_tasks_pending_wa
    ON public.user_workspace_tasks(reminder_at)
    WHERE reminder_whatsapp = TRUE AND reminder_sent = FALSE AND is_completed = FALSE;

CREATE INDEX IF NOT EXISTS idx_workspace_notes_user_pinned
    ON public.user_workspace_notes(user_id, is_pinned, is_archived, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_notes_pending_wa
    ON public.user_workspace_notes(reminder_at)
    WHERE reminder_whatsapp = TRUE AND reminder_sent = FALSE AND is_archived = FALSE;

-- 5. Función y Triggers para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.update_workspace_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workspace_settings_updated_at ON public.user_workspace_settings;
CREATE TRIGGER trg_workspace_settings_updated_at
    BEFORE UPDATE ON public.user_workspace_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_workspace_updated_at();

DROP TRIGGER IF EXISTS trg_workspace_tasks_updated_at ON public.user_workspace_tasks;
CREATE TRIGGER trg_workspace_tasks_updated_at
    BEFORE UPDATE ON public.user_workspace_tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_workspace_updated_at();

DROP TRIGGER IF EXISTS trg_workspace_notes_updated_at ON public.user_workspace_notes;
CREATE TRIGGER trg_workspace_notes_updated_at
    BEFORE UPDATE ON public.user_workspace_notes
    FOR EACH ROW EXECUTE FUNCTION public.update_workspace_updated_at();

-- 6. Habilitar Row Level Security (RLS)
ALTER TABLE public.user_workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspace_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_workspace_notes ENABLE ROW LEVEL SECURITY;

-- Políticas para user_workspace_settings
DROP POLICY IF EXISTS "Usuarios gestionan su propia configuracion de workspace" ON public.user_workspace_settings;
CREATE POLICY "Usuarios gestionan su propia configuracion de workspace"
    ON public.user_workspace_settings
    FOR ALL
    USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

-- Políticas para user_workspace_tasks
DROP POLICY IF EXISTS "Usuarios gestionan sus propias tareas de workspace" ON public.user_workspace_tasks;
CREATE POLICY "Usuarios gestionan sus propias tareas de workspace"
    ON public.user_workspace_tasks
    FOR ALL
    USING (
        auth.uid() = user_id
        OR auth.uid() = assigned_by
        OR auth.jwt() ->> 'role' = 'service_role'
    )
    WITH CHECK (
        auth.uid() = user_id
        OR (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
        OR auth.jwt() ->> 'role' = 'service_role'
    );

-- Políticas para user_workspace_notes
DROP POLICY IF EXISTS "Usuarios gestionan sus propias notas de workspace" ON public.user_workspace_notes;
CREATE POLICY "Usuarios gestionan sus propias notas de workspace"
    ON public.user_workspace_notes
    FOR ALL
    USING (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.uid() = user_id OR auth.jwt() ->> 'role' = 'service_role');

-- Permisos a roles de Supabase
GRANT ALL ON public.user_workspace_settings TO authenticated, service_role;
GRANT ALL ON public.user_workspace_tasks TO authenticated, service_role;
GRANT ALL ON public.user_workspace_notes TO authenticated, service_role;
