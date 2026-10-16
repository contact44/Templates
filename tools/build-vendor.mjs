// Construit les dépendances embarquées dans site/vendor (aucun CDN requis à l'exécution) :
//  - exceljs.min.js : lecture/écriture des classeurs Excel
//  - police Inter (variable) dans site/assets/fonts
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'site/vendor'), { recursive: true });
mkdirSync(join(root, 'site/assets/fonts'), { recursive: true });

copyFileSync(join(root, 'node_modules/exceljs/dist/exceljs.min.js'), join(root, 'site/vendor/exceljs.min.js'));
copyFileSync(
  join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
  join(root, 'site/assets/fonts/inter-latin-wght-normal.woff2'),
);
console.log('Dépendances embarquées dans site/vendor et site/assets/fonts.');
