const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = '.env';
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value.trim();
    }
  });
}

const supabaseUrl = env.SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyPolicy() {
  console.log("=== Creating UPDATE Policy on billing_records ===");

  const sql = `
    -- Eliminar política anterior si existiese
    DROP POLICY IF EXISTS "Clientes pueden actualizar observaciones de sus comercios" ON public.billing_records;

    -- Crear la política de UPDATE para permitir a los clientes ingresar observaciones y apelaciones
    CREATE POLICY "Clientes pueden actualizar observaciones de sus comercios" ON public.billing_records 
    FOR UPDATE 
    USING (
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
    )
    WITH CHECK (
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

    -- Recargar el esquema de PostgREST
    NOTIFY pgrst, 'reload schema';
  `;

  const { data, error } = await supabase.rpc('exec_sql', {
    sql: sql
  });

  if (error) {
    console.error("FAIL: Error executing SQL:", error.message);
  } else {
    console.log("SUCCESS: Policy applied successfully.");
    console.log("Returned data:", data);
  }
}

applyPolicy();
