/**
 * Script CLI para ejecutar la revisión y alerta de pedidos manuales
 * Uso:
 *   node scripts/run_manual_orders_notifier.js               # Chequea según regla horaria (>12h) y no repite hoy
 *   node scripts/run_manual_orders_notifier.js --dry-run     # Simula sin enviar mensaje
 *   node scripts/run_manual_orders_notifier.js --force       # Fuerza ejecución omitiendo restricción horaria / de 1 por día
 *   node scripts/run_manual_orders_notifier.js --status      # Muestra solo el estado actual
 */

const {
  checkAndNotifyPendingManualOrders,
  getManualOrdersAlertStatus,
  fetchPendingManualOrders,
  formatManualOrdersAlertMessage
} = require('../services/manual_orders_notifier');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isForce = args.includes('--force');
  const isStatus = args.includes('--status');

  if (isStatus) {
    console.log('🔍 Consultando estado de alerta de pedidos manuales...');
    const status = await getManualOrdersAlertStatus();
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(`🤖 Iniciando verificación de pedidos manuales pendientes (force: ${isForce}, dryRun: ${isDryRun})...`);
  const result = await checkAndNotifyPendingManualOrders({
    force: isForce,
    dryRun: isDryRun
  });

  console.log('\nResultado:');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
