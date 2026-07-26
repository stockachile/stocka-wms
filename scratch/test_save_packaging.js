const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Parse .env manually
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

async function run() {
  const commerceName = 'TEST_EMBALAJE_FLOW';
  console.log(`=== Testing Insert & Update Flow for ${commerceName} ===`);

  const mockConfig = {
    origen_materiales: 'comercio',
    rm: { tipo: 'cajas', materiales: ['burbuja', 'film'] },
    regiones: { tipo: 'standard', materiales: ['burbuja'] },
    marketplace: { tipo: 'personalizado', materiales: ['otros'] }
  };

  try {
    // 1. Clean up existing test row if any
    console.log("1. Cleaning up existing test row...");
    await supabase.from('comercios_adicional_config').delete().eq('comercio', commerceName);

    // 2. Insert row
    console.log("2. Inserting new configuration record...");
    const { error: insertError } = await supabase
      .from('comercios_adicional_config')
      .insert({
        comercio: commerceName,
        comercio_id: null,
        inventario_seguimiento: false,
        pedido_trae_sigla: false,
        embalaje_config: mockConfig
      });

    if (insertError) throw insertError;
    console.log("SUCCESS: Insert succeeded!");

    // 3. Query row
    console.log("3. Fetching configuration to verify insert...");
    const { data: insertedData, error: selectError } = await supabase
      .from('comercios_adicional_config')
      .select('*')
      .eq('comercio', commerceName)
      .single();

    if (selectError) throw selectError;
    console.log("Fetched Configuration:", insertedData.embalaje_config);

    // 4. Update configuration
    console.log("4. Updating configuration record...");
    const updatedConfig = { ...mockConfig, origen_materiales: 'stocka' };
    const { error: updateError } = await supabase
      .from('comercios_adicional_config')
      .update({ embalaje_config: updatedConfig })
      .eq('comercio', commerceName);

    if (updateError) throw updateError;
    console.log("SUCCESS: Update succeeded!");

    // 5. Query updated row
    console.log("5. Fetching configuration to verify update...");
    const { data: updatedData, error: select2Error } = await supabase
      .from('comercios_adicional_config')
      .select('*')
      .eq('comercio', commerceName)
      .single();

    if (select2Error) throw select2Error;
    console.log("Fetched Updated Configuration Origen:", updatedData.embalaje_config.origen_materiales);

    // 6. Clean up
    console.log("6. Cleaning up test record...");
    await supabase.from('comercios_adicional_config').delete().eq('comercio', commerceName);
    console.log("ALL TESTS COMPLETED SUCCESSFULLY!");
  } catch (err) {
    console.error("FAIL: Error in DB operations:", err.message || err);
  }
}

run();
