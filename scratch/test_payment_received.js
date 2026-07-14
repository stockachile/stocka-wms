const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://ejtjfaucnxbikrwjwwdu.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVqdGpmYXVjbnhiaWtyd2p3d2R1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgzMTE4NSwiZXhwIjoyMDk1NDA3MTg1fQ.YX4okf4XNkkVQaU0XbbRtm4SNRTqvwEVNd7ubc4PGe8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const commerce = 'STOCKA STORE TEST';
  
  // 1. Obtener un registro de facturación de prueba
  console.log("Obteniendo registro de facturación de prueba...");
  const { data: records, error: fetchErr } = await supabase
    .from('billing_records')
    .select('id, pago_fulfillment')
    .eq('comercio', commerce)
    .limit(1);

  if (fetchErr || !records || records.length === 0) {
    console.error("No se encontró ningún registro para STOCKA STORE TEST:", fetchErr);
    return;
  }

  const record = records[0];
  console.log(`Registro seleccionado: ID ${record.id}, Pago Fulf actual: ${record.pago_fulfillment}`);

  // Restablecer a 'Por solicitar' para simular el cambio
  await supabase
    .from('billing_records')
    .update({ pago_fulfillment: 'Por solicitar' })
    .eq('id', record.id);

  console.log("Cambiando pago_fulfillment a 'Recibido'...");
  const { error: updateErr } = await supabase
    .from('billing_records')
    .update({ pago_fulfillment: 'Recibido' })
    .eq('id', record.id);

  if (updateErr) {
    console.error("Error al actualizar estado de pago:", updateErr);
    return;
  }

  console.log("Verificando si se agregó a la cola de correos...");
  const { data: queueItems, error: qErr } = await supabase
    .from('billing_email_queue')
    .select('*')
    .eq('record_id', record.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (qErr || !queueItems || queueItems.length === 0) {
    console.error("No se encontró la cola de correos:", qErr);
    return;
  }

  const item = queueItems[0];
  console.log("ELEMENTO ENCOLADO ENCONTRADO:");
  console.log(JSON.stringify(item, null, 2));

  console.log("Modificando send_at a un tiempo pasado para procesarlo de inmediato...");
  const { error: modErr } = await supabase
    .from('billing_email_queue')
    .update({ send_at: new Date(Date.now() - 60000).toISOString() })
    .eq('id', item.id);

  if (modErr) {
    console.error("Error al modificar send_at:", modErr);
    return;
  }

  console.log("Ejecutando process_billing_email_queue() mediante RPC...");
  const { data: result, error: rpcErr } = await supabase.rpc('process_billing_email_queue');
  if (rpcErr) {
    console.error("Error al ejecutar RPC de procesamiento:", rpcErr);
    return;
  }

  console.log("RESULTADO DEL PROCESAMIENTO:", result);

  console.log("Esperando 3 segundos para consultar pg_net...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  const { data: responses, error: resErr } = await supabase.rpc('get_pg_net_responses');
  if (resErr) {
    console.error("Error al obtener respuestas de pg_net:", resErr);
    return;
  }

  console.log("ÚLTIMA RESPUESTA DE PG_NET:");
  console.log(JSON.stringify(responses[0], null, 2));
}

main();
