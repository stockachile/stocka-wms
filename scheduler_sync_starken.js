const { exec } = require('child_process');
const path = require('path');

const INTERVAL_HOURS = 3;
const INTERVAL_MS = INTERVAL_HOURS * 60 * 60 * 1000;

function runSync() {
  const timestamp = new Date().toLocaleString('es-CL');
  console.log(`====================================================`);
  console.log(`[${timestamp}] 🔄 Ejecutando sincronización periódica Starken Pro...`);
  console.log(`====================================================`);

  const child = exec('node sync_starken.js', { cwd: __dirname }, (error, stdout, stderr) => {
    if (stdout) console.log(stdout.trim());
    if (stderr && !stderr.includes('Debugger')) console.error(stderr.trim());
    
    const nextTime = new Date(Date.now() + INTERVAL_MS).toLocaleTimeString('es-CL');
    console.log(`\n⏳ Esperando próximo ciclo. Próxima sincronización a las: ${nextTime}\n`);
  });
}

console.log('====================================================');
console.log(`⏱️ Programador Continuo de Starken Pro`);
console.log(`Frecuencia: Cada ${INTERVAL_HOURS} horas`);
console.log('Presiona Ctrl + C para detener.');
console.log('====================================================\n');

// Ejecución inmediata al iniciar
runSync();

// Ejecución cíclica cada 3 horas
setInterval(runSync, INTERVAL_MS);
