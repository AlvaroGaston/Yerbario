// Servidor local mínimo: sirve /public y ejecuta los handlers de /api igual que Vercel.
// Uso: npm run dev  (carga .env.local con --env-file; no usa `vercel dev`).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const apiDir = join(root, 'api');
const port = Number(process.env.PORT) || 3000;

const vercelConfig = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const globalHeaders = (vercelConfig.headers || []).flatMap(rule => rule.headers);

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon',
};

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

// /api/login -> api/login.js ; /api/yerbas -> api/yerbas/index.js ; resto -> api/not-found.js
async function apiModule(pathname) {
  const name = pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  if (/^[a-z0-9-]+(\/[a-z0-9-]+)*$/i.test(name)) {
    for (const candidate of [join(apiDir, `${name}.js`), join(apiDir, name, 'index.js')]) {
      if (await isFile(candidate)) return candidate;
    }
  }
  return join(apiDir, 'not-found.js');
}

async function serveStatic(pathname, res) {
  let file = normalize(join(publicDir, decodeURIComponent(pathname)));
  if (!file.startsWith(publicDir + sep) && file !== publicDir) { res.statusCode = 403; return res.end(); }
  if (!(await isFile(file))) file = join(file, 'index.html');
  if (!(await isFile(file))) { res.statusCode = 404; return res.end('No encontrado'); }
  res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
  res.end(await readFile(file));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  for (const { key, value } of globalHeaders) res.setHeader(key, value);
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      req.query = Object.fromEntries(url.searchParams);
      const { default: handler } = await import(pathToFileURL(await apiModule(url.pathname)).href);
      await handler(req, res);
    } else {
      await serveStatic(url.pathname, res);
    }
  } catch (err) {
    console.error('[dev-server] error', req.method, url.pathname, err.message, err.code ?? '');
    if (!res.headersSent) { res.statusCode = 500; res.end('Error interno del servidor local'); }
  }
}).listen(port, () => {
  const missing = ['DATABASE_URL', 'SESSION_SECRET', 'INVITE_CODE', 'BLOB_READ_WRITE_TOKEN'].filter(name => !process.env[name]);
  console.log(`Yerbario local en http://localhost:${port}`);
  if (missing.length) console.warn(`Aviso: faltan variables en .env.local: ${missing.join(', ')}`);
});
