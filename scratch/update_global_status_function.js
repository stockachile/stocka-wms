const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Parse .env manually
const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

const env = {};
envContent.split('\n').forEach(line => {
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

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const updateFunctionSql = `
CREATE OR REPLACE FUNCTION get_global_status(source_table TEXT, status_str TEXT)
RETURNS TEXT AS $$
DECLARE
  s TEXT;
BEGIN
  IF status_str IS NULL THEN
    RETURN NULL;
  END IF;
  
  s := LOWER(TRIM(status_str));
  
  IF source_table = 'lightdata_envios' THEN
    IF s IN ('no retirado', 'a retirar') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('entregado', 'nadie') 
       OR s LIKE '%camino%' 
       OR s LIKE '%planta%' 
       OR s LIKE '%recepcionado%' 
       OR s LIKE '%procesamiento%' 
       OR s LIKE '%clasificado%' 
       OR s LIKE '%entregado%' THEN
      RETURN 'DESPACHADO';
    ELSIF s = 'cancelado' THEN
      RETURN 'ALERTA';
    END IF;
  ELSIF source_table = 'optiroute_orders' THEN
    IF s = 'reviewing' THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('skipped', 'onroute', 'ongoing', 'delivered') THEN
      RETURN 'DESPACHADO';
    END IF;
  ELSIF source_table = 'enviame_shipments' THEN
    IF s IN ('creado', 'eliminado', 'rechazado por courier', 'listo para despacho - impreso', 'listo para despacho') THEN
      RETURN 'SIN MOVIMIENTO';
    ELSIF s IN ('devolucion', 'en reparto', 'en tránsito', 'entregado', 'no hay quien reciba', 'extraviado', 'expirado', 'entregado con exito') OR s LIKE '%planta%' THEN
      RETURN 'DESPACHADO';
    END IF;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
`;

const updateRowsSql = `
UPDATE envios_unificados
SET global_status = get_global_status(source_table, status)
WHERE source_table = 'lightdata_envios';
`;

async function run() {
  console.log("=== Updating get_global_status function in database ===");
  const { data: data1, error: err1 } = await supabase.rpc('exec_sql', { sql: updateFunctionSql });
  if (err1) {
    console.error("Error updating function:", err1);
    return;
  }
  console.log("Function updated successfully.");

  console.log("=== Updating existing rows in envios_unificados ===");
  const { data: data2, error: err2 } = await supabase.rpc('exec_sql', { sql: updateRowsSql });
  if (err2) {
    console.error("Error updating rows:", err2);
    return;
  }
  console.log("Rows updated successfully.");
}

run();
