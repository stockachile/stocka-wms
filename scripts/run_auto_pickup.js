/**
 * Script CLI para ejecutar la automatización de retiros
 * Uso:
 *   node scripts/run_auto_pickup.js                      # Procesa todas las órdenes pendientes
 *   node scripts/run_auto_pickup.js --dry-run            # Simula sin modificar datos ni enviar mensajes
 *   node scripts/run_auto_pickup.js <order_id>           # Procesa una orden específica
 *   node scripts/run_auto_pickup.js <order_id> --dry-run
 */

const { autoProcessSinglePickupOrder, processAllPendingPickups } = require('../services/auto_pickup_service');

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isForce = args.includes('--force');
  const nonFlagArgs = args.filter(a => !a.startsWith('--'));

  // Target group opcional por CLI o fallback al grupo de Ñuñoa
  const targetGroup = process.env.TARGET_WA_GROUP || '120363043911687615@g.us'; // Por defecto Coordinación para pruebas seguras

  if (nonFlagArgs.length > 0) {
    const orderId = nonFlagArgs[0];
    console.log(`🚀 Ejecutando AutoPickup para orden individual: ${orderId} (Modo Simulación: ${isDryRun})...`);
    const result = await autoProcessSinglePickupOrder(orderId, {
      dryRun: isDryRun,
      targetGroup: targetGroup
    });
    console.log('\nResultado:', JSON.stringify(result, null, 2));
  } else {
    console.log(`🚀 Escaneando órdenes pendientes de Retiro (Modo Simulación: ${isDryRun}, Forzar Horario: ${isForce})...`);
    const result = await processAllPendingPickups({
      dryRun: isDryRun,
      force: isForce,
      targetGroup: targetGroup,
      limit: 5
    });
    console.log('\nResumen:', JSON.stringify(result, null, 2));
  }
}

main().catch(console.error);
