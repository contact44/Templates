// Construit un aperçu autonome : un seul fichier HTML (mode local, données fictives), sans serveur.
// Usage : node tools/build-preview.mjs [fichier de sortie]
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist/apercu-saison-contractuelle.html');
mkdirSync(dirname(out), { recursive: true });

const js = await build({
  entryPoints: [join(root, 'site/assets/js/main.js')],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false, logLevel: 'error',
});
const font = readFileSync(join(root, 'site/assets/fonts/inter-latin-wght-normal.woff2')).toString('base64');
const css = readFileSync(join(root, 'site/assets/css/app.css'), 'utf8')
  .replace('url("../fonts/inter-latin-wght-normal.woff2")', `url("data:font/woff2;base64,${font}")`);
const favicon = Buffer.from(readFileSync(join(root, 'site/favicon.svg'))).toString('base64');
const exceljs = readFileSync(join(root, 'site/vendor/exceljs.min.js'), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="fr" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Saison contractuelle 2027 – aperçu</title>
<link rel="icon" href="data:image/svg+xml;base64,${favicon}">
<style>${css}</style>
<script>try{var p=JSON.parse(localStorage.getItem('saison:prefs')||'{}');document.documentElement.dataset.theme=p.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(e){}</script>
<script>window.APP_CONFIG={firebase:null,seasonId:'apercu-2027',preview:true};</script>
</head>
<body>
<div id="app"><div class="boot"><div class="boot-spinner" aria-label="Chargement"></div></div></div>
<script>${safe(exceljs)}</script>
<script>${safe(js.outputFiles[0].text)}</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`Aperçu : ${out} (${Math.round(html.length / 1024)} Ko)`);
