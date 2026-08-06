-- =========================================================================
-- SQL Migration Script: Communications System Improvements
-- =========================================================================
-- 
-- INSTRUCTION:
-- Copy this entire file and run it in the SQL Editor on your Supabase Console
-- (https://supabase.com/dashboard/project/ejtjfaucnxbikrwjwwdu/sql/new)
-- =========================================================================

-- 1. Alter system_banners table
ALTER TABLE system_banners ADD COLUMN IF NOT EXISTS is_dismissible BOOLEAN DEFAULT true;
ALTER TABLE system_banners ADD COLUMN IF NOT EXISTS target_role VARCHAR(50) DEFAULT 'all';
ALTER TABLE system_banners ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'ri-information-fill';
ALTER TABLE system_banners ADD COLUMN IF NOT EXISTS style_preset VARCHAR(50) DEFAULT 'info';

-- 2. Alter system_popups table
ALTER TABLE system_popups ADD COLUMN IF NOT EXISTS is_dismissible BOOLEAN DEFAULT true;
ALTER TABLE system_popups ADD COLUMN IF NOT EXISTS target_role VARCHAR(50) DEFAULT 'all';
ALTER TABLE system_popups ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'ri-notification-3-line';
ALTER TABLE system_popups ADD COLUMN IF NOT EXISTS style_preset VARCHAR(50) DEFAULT 'info';

-- 3. Notify the system that tables have been altered
COMMENT ON TABLE system_banners IS 'Banners creados por el admin para avisos en el portal, mejorado con segmentación y persistencia';
COMMENT ON TABLE system_popups IS 'Ventanas modal emergentes de inicio de sesión creadas por el admin, mejorado con conteo de lectura obligatoria y segmentación';
