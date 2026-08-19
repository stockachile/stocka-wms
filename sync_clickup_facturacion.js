const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Cargar variables de entorno desde .env
const projectDir = __dirname;
const envPath = path.join(projectDir, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = match[2] || '';
      if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1);
      env[match[1]] = val.trim();
    }
  });
}

const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const clickupToken = process.env.CLICKUP_API_KEY || env.CLICKUP_API_KEY;
const spaceId = process.env.CLICKUP_FACTURACION_SPACE_ID || env.CLICKUP_FACTURACION_SPACE_ID || '90170718518'; // Espacio FACTURACION

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("ERROR: No se encontró SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const clickupHeaders = { 'Authorization': clickupToken };

// Helper para parsear campos personalizados
function parseCustomFieldValue(cf) {
  if (!cf || cf.value === undefined || cf.value === null) return null;
  
  // Dropdown (Extrae el nombre de la opción seleccionada)
  if (cf.type === 'drop_down' && cf.type_config?.options) {
    const val = cf.value;
    const opt = cf.type_config.options.find(o => o.id === val || o.orderindex === val);
    return opt ? opt.name : String(val);
  }
  
  // Date (Timestamp a ISO string)
  if (cf.type === 'date') {
    const ts = parseInt(cf.value);
    return !isNaN(ts) ? new Date(ts).toISOString() : null;
  }

  // Numbers & Currency & Formula
  if (cf.type === 'number' || cf.type === 'currency' || cf.type === 'formula') {
    const num = parseFloat(cf.value);
    return !isNaN(num) ? num : null;
  }

  return String(cf.value);
}

// Helper para transformar cada tarea de ClickUp al registro de Supabase
function transformTask(task) {
  const customFieldsMap = {};
  (task.custom_fields || []).forEach(cf => {
    customFieldsMap[cf.name] = parseCustomFieldValue(cf);
  });

  return {
    task_id: task.id,
    task_name: task.name,
    list_id: task.list?.id,
    list_name: task.list?.name || 'Desconocido',
    space_id: task.space?.id || spaceId,
    space_name: 'FACTURACION',
    status: task.status?.status || null,
    status_color: task.status?.color || null,
    comercio: customFieldsMap['COMERCIO'] || null,
    mes: customFieldsMap['MES'] || null,
    fecha_limite: customFieldsMap['Fecha limite'] || customFieldsMap['Fecha límite'] || null,
    desglose_fulfillment: customFieldsMap['DESGLOSE FULFILLMENT'] || customFieldsMap['DESGLOSE FULFIL...'] || null,
    total_fulf: customFieldsMap['💰 Total FULF'] || customFieldsMap['Total FULF'] || null,
    abonos_fulf: customFieldsMap['Abonos FULF.'] || customFieldsMap['Abonos FULF'] || null,
    pago_fulfillment: customFieldsMap['PAGO FULLFILMENT'] || null,
    factura_fulfillment: customFieldsMap['FACTURA FULFILLMENT'] || customFieldsMap['FACTURA FULFIL...'] || null,
    n_fact: customFieldsMap['N°FACT'] || null,
    enviame: customFieldsMap['💰 ENVIAME'] || customFieldsMap['ENVIAME'] || null,
    abono_env: customFieldsMap['Abono ENV.'] || null,
    pago_enviame: customFieldsMap['PAGO ENVIAME'] || null,
    fact_enviame: customFieldsMap['FACT. ENVIAME'] || null,
    n_fact_env: customFieldsMap['N°FACT ENV.'] || null,
    total: customFieldsMap['TOTAL'] || null,
    total_fact: customFieldsMap['TOTAL FACT'] || null,
    monto: customFieldsMap['MONTO'] || null,
    ultimo_desglose: customFieldsMap['ULTIMO DESGLOSE'] || null,
    alpha: customFieldsMap['ALPHA'] || null,
    dif_s: customFieldsMap['DIF S'] ? String(customFieldsMap['DIF S']) : null,
    time_formula: customFieldsMap['TIME'] ? String(customFieldsMap['TIME']) : null,
    date_created: task.date_created ? new Date(parseInt(task.date_created)).toISOString() : null,
    date_updated: task.date_updated ? new Date(parseInt(task.date_updated)).toISOString() : null,
    date_closed: task.date_closed ? new Date(parseInt(task.date_closed)).toISOString() : null,
    url: task.url || null,
    raw_custom_fields: task.custom_fields || [],
    synced_at: new Date().toISOString()
  };
}

async function syncClickupFacturacion() {
  console.log("=== INICIANDO EXTRACCIÓN Y SINCRONIZACIÓN DE CLICKUP (FACTURACION) ===");
  console.log(`Fecha/Hora: ${new Date().toLocaleString()}`);

  // 1. Obtener listas del espacio FACTURACION
  const listsUrl = `https://api.clickup.com/api/v2/space/${spaceId}/list`;
  const listsRes = await fetch(listsUrl, { headers: clickupHeaders });
  if (!listsRes.ok) {
    throw new Error(`Error HTTP al consultar listas de ClickUp: ${listsRes.status} ${listsRes.statusText}`);
  }
  const listsData = await listsRes.json();
  const lists = listsData.lists || [];
  console.log(`Se encontraron ${lists.length} listas en el espacio FACTURACION:`, lists.map(l => l.name));

  let totalTasksExtracted = 0;
  let totalTasksUpserted = 0;

  // 2. Recorrer cada lista y extraer tareas en páginas
  for (const list of lists) {
    console.log(`\nExtrayendo lista '${list.name}' (ID: ${list.id})...`);
    let page = 0;
    let listTasks = [];

    while (true) {
      const taskUrl = `https://api.clickup.com/api/v2/list/${list.id}/task?subtasks=true&include_closed=true&page=${page}`;
      const res = await fetch(taskUrl, { headers: clickupHeaders });
      if (!res.ok) {
        console.error(`Error al obtener página ${page} de la lista ${list.name}: ${res.status}`);
        break;
      }
      const data = await res.json();
      const tasks = data.tasks || [];
      if (tasks.length === 0) break;

      listTasks = listTasks.concat(tasks);
      if (data.last_page) break;
      page++;
    }

    console.log(`  -> Obtenidas ${listTasks.length} tareas de la lista '${list.name}'.`);
    totalTasksExtracted += listTasks.length;

    // 3. Transformar e Insertar/Actualizar en Supabase en lotes (batch size 100)
    const records = listTasks.map(transformTask);
    const BATCH_SIZE = 100;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { data: upsertData, error: upsertError } = await supabase
        .from('clickup_facturacion')
        .upsert(batch, { onConflict: 'task_id' });

      if (upsertError) {
        console.error(`  [ERROR] Falló la inserción en Supabase (lote ${i} - ${i + batch.length}):`, upsertError);
      } else {
        totalTasksUpserted += batch.length;
      }
    }
  }

  console.log("\n==================================================");
  console.log("=== RESUMEN DE SINCRONIZACIÓN CLICKUP FACTURACION ===");
  console.log(`Tareas extraídas desde ClickUp: ${totalTasksExtracted}`);
  console.log(`Registros guardados en Supabase: ${totalTasksUpserted}`);
  console.log("==================================================");
}

syncClickupFacturacion().catch(err => {
  console.error("FATAL ERROR durante la sincronización:", err);
  process.exit(1);
});
