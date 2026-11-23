// scripts/dev_server.js - Servidor local de desarrollo con soporte nativo para _redirects (Netlify)
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PORT = Number(process.env.PORT) || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8'
};

function loadRedirects() {
  const redirectsPath = path.join(ROOT_DIR, '_redirects');
  if (!fs.existsSync(redirectsPath)) return [];
  const lines = fs.readFileSync(redirectsPath, 'utf8').split(/\r?\n/);
  const rules = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const [from, to, statusRaw] = parts;
    if (/^https?:\/\//i.test(from)) continue;

    const status = parseInt((statusRaw || '200').replace('!', ''), 10) || 200;
    const targetPath = to.split('?')[0];
    rules.push({ from, targetPath, status });
  }
  return rules;
}

function matchRedirect(reqPathname, rules) {
  for (const rule of rules) {
    if (rule.from.endsWith('/*')) {
      const prefix = rule.from.slice(0, -1); // e.g. '/admin/'
      if (reqPathname.startsWith(prefix)) {
        return rule.targetPath;
      }
    } else if (rule.from.endsWith('*')) {
      const prefix = rule.from.slice(0, -1);
      if (reqPathname.startsWith(prefix)) {
        return rule.targetPath;
      }
    } else if (reqPathname === rule.from || (reqPathname.length > 1 && reqPathname.replace(/\/+$/, '') === rule.from)) {
      return rule.targetPath;
    }
  }
  return null;
}

function resolveStaticFile(pathname) {
  const safeDecoded = decodeURIComponent(pathname);
  const relPath = safeDecoded === '/' ? '/index.html' : safeDecoded;
  const fullPath = path.resolve(ROOT_DIR, '.' + relPath);
  if (!fullPath.startsWith(ROOT_DIR)) return null;

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return fullPath;
  }
  return null;
}

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname || '/';

    // 1. Intentar archivo físico directo primero (igual que Netlify sin '!')
    let filePath = resolveStaticFile(pathname);

    // 2. Si no existe archivo directo, evaluar reglas de _redirects
    if (!filePath) {
      const rules = loadRedirects();
      const rewritten = matchRedirect(pathname, rules);
      if (rewritten) {
        filePath = resolveStaticFile(rewritten);
      }
    }

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

server.on('listening', () => {
  const actualPort = server.address().port;
  console.log('');
  console.log('🚀 Servidor local WMS STOCKA activo (con soporte _redirects):');
  console.log(`   👉 Login:          http://localhost:${actualPort}/`);
  console.log(`   👉 Admin:          http://localhost:${actualPort}/admin`);
  console.log(`   👉 Ej. Pedidos:    http://localhost:${actualPort}/admin/pedidos`);
  console.log(`   👉 Portal Cliente: http://localhost:${actualPort}/panel`);
  console.log(`   👉 Ej. Inventario: http://localhost:${actualPort}/panel/inventario`);
  console.log('');
});

function startListening(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < DEFAULT_PORT + 10) {
      startListening(port + 1);
    } else {
      console.error('❌ Error iniciando servidor local:', err.message);
      process.exit(1);
    }
  });

  server.listen(port);
}

startListening(DEFAULT_PORT);
