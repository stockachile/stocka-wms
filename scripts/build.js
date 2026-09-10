// scripts/build.js - WMS STOCKA Production Build & Minification Script
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('🚀 Iniciando compilación de producción para WMS STOCKA...');
const startTime = Date.now();

// 1. Limpiar o crear carpeta dist/
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Copiar archivos raíz (HTML, redirecciones, iconos)
const rootFiles = fs.readdirSync(ROOT_DIR);
let htmlCount = 0;
rootFiles.forEach(file => {
  const fullPath = path.join(ROOT_DIR, file);
  if (fs.statSync(fullPath).isFile()) {
    if (file.endsWith('.html') || file === '_redirects' || file === 'favicon.png' || file === 'robots.txt') {
      fs.copyFileSync(fullPath, path.join(DIST_DIR, file));
      if (file.endsWith('.html')) htmlCount++;
    }
  }
});
console.log(`✅ ${htmlCount} archivos HTML y configuración copiados a dist/`);

// 3. Copiar directorios estáticos
const staticDirs = ['css', 'img', 'images', 'assets', 'downloads'];
staticDirs.forEach(dir => {
  const src = path.join(ROOT_DIR, dir);
  const dest = path.join(DIST_DIR, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log(`📁 Directorio estático '${dir}' sincronizado a dist/`);
  }
});

// 4. Compilar y minificar JavaScript con esbuild
const jsSrcDir = path.join(ROOT_DIR, 'js');
const jsDestDir = path.join(DIST_DIR, 'js');
fs.mkdirSync(jsDestDir, { recursive: true });

const jsFiles = fs.readdirSync(jsSrcDir)
  .filter(f => f.endsWith('.js'))
  .map(f => path.join(jsSrcDir, f));

try {
  esbuild.buildSync({
    entryPoints: jsFiles,
    outdir: jsDestDir,
    minify: true,
    target: 'es2020',
    legalComments: 'none'
  });
  console.log(`⚡ ${jsFiles.length} archivos JavaScript minificados y ofuscados exitosamente en dist/js/`);
} catch (err) {
  console.error('❌ Error durante la minificación de JavaScript:', err);
  process.exit(1);
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`✨ ¡Compilación completada con éxito en ${duration}s! Carpeta lista para publicación: dist/`);
