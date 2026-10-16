// Outils communs aux tests de bout en bout : serveur statique et navigateur.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = fileURLToPath(new URL('../../site/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

export async function serve(root = ROOT, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      const file = join(root, p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      await stat(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

export async function launch() {
  const opts = {};
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch(opts);
}

export function watchErrors(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
}

let passed = 0; let failed = 0;
export async function step(name, fn, timeoutMs = 90000) {
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`Étape interrompue après ${timeoutMs / 1000} s`)), timeoutMs))]); passed++; console.log(`  ✔ ${name}`);
  } catch (err) { failed++; console.log(`  ✘ ${name}\n    ${err.stack || err}`); }
}
export function summary() { console.log(`\n${passed} réussi(s), ${failed} échec(s)`); return failed; }
export function assert(cond, msg) { if (!cond) throw new Error(`Assertion : ${msg}`); }
export function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }
