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

async function inspectOtherModules() {
  console.log("=== Inspecting Other Tables for MAGIC MAKEUP ===");
  const userId = 'bd23767f-869d-4c52-91d0-2d2ef95cb8c0';
  const commerce = 'MAGIC MAKEUP';

  // 1. Check tickets
  try {
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('comercio', commerce);
    if (error) throw error;
    console.log(`Tickets: found ${tickets.length}`);
    tickets.forEach(t => {
      console.log(`- Ticket ID: ${t.id} | Subject: "${t.subject}" | Status: "${t.status}" | Created: ${t.created_at}`);
      console.log(`  Message: "${t.description || t.message || ''}"`);
    });
  } catch (err) {
    console.warn("Tickets table not accessible or error:", err.message);
  }

  // 2. Check incidencias
  try {
    const { data: incidencias, error } = await supabase
      .from('incidencias')
      .select('*')
      .eq('comercio', commerce);
    if (error) throw error;
    console.log(`Incidencias: found ${incidencias.length}`);
    incidencias.forEach(i => {
      console.log(`- Incidencia ID: ${i.id} | Title: "${i.titulo || i.subject}" | Status: "${i.status}" | Created: ${i.created_at}`);
      console.log(`  Description: "${i.descripcion || i.message || ''}"`);
    });
  } catch (err) {
    console.warn("Incidencias table not accessible or error:", err.message);
  }

  // 3. Let's see if there is any other table like billing_comments, payment_receipts, payment_reports
  try {
    const { data: reports, error } = await supabase
      .from('payment_reports')
      .select('*')
      .eq('comercio', commerce);
    if (error) throw error;
    console.log(`Payment Reports: found ${reports.length}`);
    reports.forEach(r => {
      console.log(`- Report ID: ${r.id} | Monto: ${r.monto} | Periodo: ${r.periodo_nombre} | Status: "${r.status}" | Created: ${r.created_at}`);
      console.log(`  Notes: "${r.notes || r.comentarios || ''}"`);
    });
  } catch (err) {
    console.warn("payment_reports table not accessible or error:", err.message);
  }
}

inspectOtherModules();
