-- Migración: Tabla de Reuniones Comerciales (HubSpot Meetings + Notas de Gemini en Google Meet)
CREATE TABLE IF NOT EXISTS public.lead_meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_email TEXT NOT NULL,
    contact_name TEXT,
    company_name TEXT,
    phone TEXT,
    hubspot_meeting_id TEXT,
    hubspot_contact_id TEXT,
    meeting_title TEXT DEFAULT 'Reunión Comercial Stocka Fulfillment 360',
    meeting_start_at TIMESTAMPTZ,
    meeting_end_at TIMESTAMPTZ,
    meeting_status TEXT DEFAULT 'scheduled', -- 'scheduled' | 'completed' | 'rescheduled' | 'no_show' | 'canceled'
    meet_url TEXT,
    gemini_doc_url TEXT,
    gemini_notes_raw TEXT,
    ai_summary_json JSONB DEFAULT '{}'::jsonb,
    agreed_monthly_orders INTEGER,
    agreed_volume_m3 NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_meetings_email ON public.lead_meetings (lower(lead_email));
CREATE INDEX IF NOT EXISTS idx_lead_meetings_hubspot_id ON public.lead_meetings (hubspot_meeting_id);

ALTER TABLE public.lead_meetings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'lead_meetings' AND policyname = 'Allow authenticated full access to lead_meetings'
    ) THEN
        CREATE POLICY "Allow authenticated full access to lead_meetings"
            ON public.lead_meetings
            FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END
$$;
