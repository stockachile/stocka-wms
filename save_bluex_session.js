const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STATE_FILE = path.join(__dirname, 'bluex_state.json');

console.log('====================================================');
console.log('📋 Asistente Alternativo: Copiar sesión desde tu navegador');
console.log('====================================================');
console.log('Si ya tienes la sesión iniciada en tu navegador habitual (Chrome/Edge):');
console.log('1. Abre https://app.bluex.cl/dashboard en tu navegador.');
console.log('2. Presiona F12 para abrir las herramientas de desarrollador y ve a la pestaña "Console" (Consola).');
console.log('3. Pega y ejecuta el siguiente comando:\n');
console.log(`copy(JSON.stringify({ cookies: [], origins: [{ origin: "https://app.bluex.cl", localStorage: Object.keys(localStorage).map(k => ({ name: k, value: localStorage.getItem(k) })) }] }));`);
console.log('\n(Esto copiará automáticamente todos tus tokens de Blue Express al portapapeles)');
console.log('====================================================');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nPega aquí lo que se copió al portapapeles y presiona ENTER:\n> ', (input) => {
  try {
    const clean = input.trim();
    const parsed = JSON.parse(clean);
    fs.writeFileSync(STATE_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
    console.log(`\n✅ ¡Sesión guardada exitosamente en ${STATE_FILE}!`);
    console.log('Ya puedes ejecutar: npm run sync:bluex');
  } catch (e) {
    console.error('\n❌ Error al procesar el texto pegado:', e.message);
    console.log('Asegúrate de pegar exactamente lo que copió el comando en la consola del navegador.');
  } finally {
    rl.close();
  }
});
