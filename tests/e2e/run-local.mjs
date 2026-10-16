// Tests de bout en bout en mode local (sans Firebase) : grille, fiche, automatisations,
// annulation, collage Excel, pipeline, paramètres, import / export Excel, sauvegarde.
// Lancement : npm run test:e2e
import ExcelJS from 'exceljs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, eq, launch, serve, step, summary, watchErrors } from './helpers.mjs';

const TODAY = '2026-10-16';
const server = await serve();
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
const page = await context.newPage();
const errors = [];
watchErrors(page, errors);
const base = `${server.url}?today=${TODAY}`;
const tmp = await mkdtemp(join(tmpdir(), 'saison-e2e-'));

const store = (fn, arg) => page.evaluate(([f, a]) => (0, eval)(`(${f})`)(window.__app.store, a), [fn.toString(), arg]);
const contractByClient = (name) => store((s, n) => s.state.list.find((c) => c.values.client === n), name);
const settle = () => page.waitForTimeout(250);

console.log('Tests de bout en bout — mode local');

await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.goto(base);
await page.waitForSelector('.shell');

await step('Tableau de bord vide : propose l’import, la création et la démonstration', async () => {
  await page.waitForSelector('.empty');
  assert(await page.isVisible('text=Importer un fichier Excel'), 'bouton import');
  assert(await page.isVisible('text=Données de démonstration'), 'bouton démo');
});

await step('Chargement des données de démonstration', async () => {
  await page.click('button[data-act="demo"]');
  await page.waitForSelector('.hero-num');
  const n = await store((s) => s.state.list.length);
  eq(n, 42, 'nombre de contrats');
  const hero = await page.textContent('.hero-num');
  eq(hero.trim(), 'J-136', 'compte à rebours au 16/10/2026');
  assert((await page.$$('.kpi')).length === 6, '6 indicateurs');
});

await step('Grille : 42 lignes, colonnes figées alignées avec l’en-tête', async () => {
  await page.click('a[data-route="suivi"]');
  await page.waitForSelector('table.grid tbody tr[data-id]');
  eq((await page.$$('table.grid tbody tr[data-id]')).length, 42, 'lignes');
  const th = await page.$eval('th[data-key="client"]', (e) => e.getBoundingClientRect().left);
  const td = await page.$eval('tbody tr[data-id] td[data-c="1"]', (e) => e.getBoundingClientRect().left);
  assert(Math.abs(th - td) < 1, `alignement client (th ${th} / td ${td})`);
});

await step('Édition d’un texte dans la cellule (Entrée)', async () => {
  await page.click('tbody tr[data-id]:nth-child(1) td[data-c="2"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cell-input');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Groupe Test');
  await page.keyboard.press('Enter');
  await settle();
  const c = await contractByClient('Alto Distribution');
  eq(c.values.groupe, 'Groupe Test', 'groupe modifié');
});

await step('Saisie directe au clavier puis Tab', async () => {
  await page.click('tbody tr[data-id]:nth-child(2) td[data-c="7"]');
  await page.keyboard.type('Nouveau KAM');
  await page.keyboard.press('Tab');
  await settle();
  const c = await contractByClient('Brio Électro');
  eq(c.values.kam, 'Nouveau KAM', 'KAM saisi');
});

await step('Statut via la liste déroulante + automatisation date de signature', async () => {
  const statusIdx = await page.$eval('th[data-key="statut"]', (e) => e.dataset.c);
  await page.click(`tbody tr[data-id]:nth-child(1) td[data-c="${statusIdx}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.picker');
  await page.fill('.picker-search input', 'sign');
  await page.click('.picker-opt:has-text("Signé")');
  await settle();
  const c = await contractByClient('Alto Distribution');
  eq(c.values.statut, 'Signé', 'statut');
  eq(c.values.dateSignature, TODAY, 'date de signature renseignée automatiquement');
});

await step('Annulation (Ctrl+Z) de la dernière modification', async () => {
  await page.focus('.grid-scroll');
  await page.keyboard.press('Control+z');
  await settle();
  const c = await contractByClient('Alto Distribution');
  assert(c.values.statut !== 'Signé', 'statut rétabli');
  assert(!c.values.dateSignature, 'date de signature effacée');
});

await step('Calendrier français dans une cellule date (saisie « 01/12 »)', async () => {
  const idx = await page.$eval('th[data-key="echeance"]', (e) => e.dataset.c);
  await page.click(`tbody tr[data-id]:nth-child(3) td[data-c="${idx}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cal');
  const title = await page.textContent('.cal-title');
  assert(/[a-zé]+ 20\d\d/.test(title), `titre du mois en français (${title})`);
  await page.fill('.cal-input input', '01/12');
  await page.keyboard.press('Enter');
  await settle();
  const c = await contractByClient('Cobalt Hypermarchés');
  eq(c.values.echeance, '2026-12-01', 'échéance');
  const shown = await page.textContent(`tbody tr[data-id]:nth-child(3) td[data-c="${idx}"]`);
  assert(shown.includes('01/12/2026'), `affichage jj/mm/aaaa (${shown})`);
});

await step('Collage d’un bloc copié depuis Excel (2 × 2)', async () => {
  const kam = await page.$eval('th[data-key="kam"]', (e) => Number(e.dataset.c));
  const prio = await page.$eval('th[data-key="priorite"]', (e) => Number(e.dataset.c));
  eq(prio, kam + 1, 'priorité juste après KAM');
  await page.click(`tbody tr[data-id]:nth-child(4) td[data-c="${kam}"]`);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Anne K.\tP1 – Critique\r\nBruno L.\tp2\r\n');
    document.querySelector('.grid-scroll').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await settle();
  const a = await contractByClient('Delta Hi-Fi');
  const b = await contractByClient('Écho Multimédia');
  eq([a.values.kam, a.values.priorite], ['Anne K.', 'P1 – Critique'], 'ligne 1');
  eq([b.values.kam, b.values.priorite], ['Bruno L.', 'P2 – Haute'], 'ligne 2 (valeur reconnue)');
});

await step('Copie d’une plage au format TSV', async () => {
  const kam = await page.$eval('th[data-key="kam"]', (e) => Number(e.dataset.c));
  await page.click(`tbody tr[data-id]:nth-child(4) td[data-c="${kam}"]`);
  await page.click(`tbody tr[data-id]:nth-child(5) td[data-c="${kam + 1}"]`, { modifiers: ['Shift'] });
  const text = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.querySelector('.grid-scroll').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true }));
    return dt.getData('text/plain');
  });
  eq(text, 'Anne K.\tP1 – Critique\nBruno L.\tP2 – Haute', 'TSV copié');
});

await step('Recherche et filtre rapide', async () => {
  await page.fill('.filterbar input[type="search"]', 'Alto');
  await page.waitForTimeout(400);
  eq((await page.$$('tbody tr[data-id]')).length, 3, '« Alto » : le client et les deux enseignes du Groupe Alto');
  await page.fill('.filterbar input[type="search"]', 'echo multimedia');
  await page.waitForTimeout(400);
  eq((await page.$$('tbody tr[data-id]')).length, 1, 'une ligne pour « echo multimedia » (sans accents ni majuscules)');
  await page.fill('.filterbar input[type="search"]', '');
  await page.waitForTimeout(400);
  await page.click('[data-quick="blocked"]');
  await settle();
  const n = await page.$$eval('tbody tr[data-id]', (r) => r.length);
  const expected = await store((s) => s.state.list.filter((c) => s.state.derived.get(c.id).stage === 'blocked').length);
  eq(n, expected, 'filtre Bloqués');
  await settle();
  await page.click('.quick [data-quick=""]');
  await settle();
  eq((await page.$$('tbody tr[data-id]')).length, 42, 'retour à « Tous »');
});

await step('Filtre de colonne (façon Excel)', async () => {
  await page.hover('th[data-key="canal"]');
  await page.click('th[data-key="canal"] .th-filter');
  await page.waitForSelector('.colfilter');
  await page.click('.colfilter [data-all]');
  await page.click('.colfilter-opt:has-text("E-commerce") input');
  await page.click('.colfilter [data-ok]');
  await settle();
  const n = await page.$$eval('tbody tr[data-id]', (r) => r.length);
  const expected = await store((s) => s.state.list.filter((c) => c.values.canal === 'E-commerce').length);
  eq(n, expected, 'lignes E-commerce');
  await page.hover('th[data-key="canal"]');
  await page.click('th[data-key="canal"] .th-filter');
  await page.click('.colfilter [data-clear]');
  await settle();
  eq((await page.$$('tbody tr[data-id]')).length, 42, 'filtre retiré');
});

await step('Regroupement par contract manager', async () => {
  await page.click('[data-act="group"]');
  await page.click('.menu-item:has-text("Contract manager")');
  await settle();
  assert((await page.$$('.group-row')).length >= 2, 'groupes affichés');
  await page.click('[data-act="group"]');
  await page.click('.menu-item:has-text("Aucun regroupement")');
  await settle();
  eq((await page.$$('.group-row')).length, 0, 'regroupement retiré');
});

await step('Sélection multiple et modification groupée', async () => {
  await page.click('tbody tr[data-id]:nth-child(1) input[data-row]');
  await page.click('tbody tr[data-id]:nth-child(2) input[data-row]');
  await page.waitForSelector('.bulkbar:not([hidden])');
  await page.click('.bulkbar [data-bulk="priorite"]');
  await page.click('.picker-opt:has-text("P2 – Haute")');
  await settle();
  const a = await contractByClient('Alto Distribution');
  const b = await contractByClient('Brio Électro');
  eq([a.values.priorite, b.values.priorite], ['P2 – Haute', 'P2 – Haute'], 'priorités');
  await page.click('.bulkbar [data-act="bulk-clear"]');
});

await step('La sélection suit le contrat après un tri (aucune saisie sur la mauvaise ligne)', async () => {
  const idx = await page.$eval('th[data-key="kam"]', (e) => e.dataset.c);
  await page.click(`tbody tr[data-id]:nth-child(2) td[data-c="${idx}"]`);
  const id = await page.$eval('tbody tr[data-id]:nth-child(2)', (e) => e.dataset.id);
  await page.click('th[data-key="client"] .th-label');
  await page.click('th[data-key="client"] .th-label');
  await settle();
  const activeId = await page.$eval('td.active', (td) => td.closest('tr').dataset.id);
  eq(activeId, id, 'cellule active sur le même contrat');
  await page.focus('.grid-scroll');
  await page.keyboard.type('KAM suivi');
  await page.keyboard.press('Enter');
  await settle();
  eq(await store((s, i) => s.getContract(i).values.kam, id), 'KAM suivi', 'saisie sur le bon contrat');
  await store((s) => s.setPrefs({ sort: [{ key: 'ref', dir: 1 }] }));
  await settle();
});

await step('Échap annule la saisie d’un texte long', async () => {
  const idx = await page.$eval('th[data-key="commentaires"]', (e) => e.dataset.c);
  const id = await page.$eval('tbody tr[data-id]:nth-child(3)', (e) => e.dataset.id);
  const before = await store((s, i) => s.getContract(i).values.commentaires ?? null, id);
  await page.click(`tbody tr[data-id]:nth-child(3) td[data-c="${idx}"]`);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.pop-text textarea');
  await page.fill('.pop-text textarea', 'Texte à abandonner');
  await page.keyboard.press('Escape');
  await settle();
  eq(await store((s, i) => s.getContract(i).values.commentaires ?? null, id), before, 'valeur inchangée');
});

await step('Fiche contrat : champs, commentaire, historique', async () => {
  await page.hover('tbody tr[data-id]:nth-child(1)');
  await page.click('tbody tr[data-id]:nth-child(1) .open-btn');
  await page.waitForSelector('.drawer .field-row');
  assert(page.url().includes('?c='), 'lien profond dans l’URL');
  const v = page.locator('.drawer .field-row[data-key="version"] input');
  await v.fill('V7');
  await v.press('Enter');
  await settle();
  eq((await contractByClient('Alto Distribution')).values.version, 'V7', 'version');
  await page.click('.drawer .tab[data-tab="comments"]');
  await page.fill('.composer textarea', 'Point fait avec le KAM.');
  await page.click('.composer button[type="submit"]');
  await settle();
  assert(await page.isVisible('.comment:has-text("Point fait avec le KAM.")'), 'commentaire affiché');
  await page.click('.drawer .tab[data-tab="history"]');
  await settle();
  assert(await page.isVisible('.tl-item:has-text("Version en cours")'), 'historique de la version');
  await page.click('.drawer .tab[data-tab="mail"]');
  const subject = await page.inputValue('#mail-subject');
  assert(subject.includes('Alto Distribution'), `objet du mail personnalisé (${subject})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(!page.url().includes('?c='), 'fiche fermée');
});

await step('Étapes du statut dans la fiche (clic sur une étape)', async () => {
  await page.click('tbody tr[data-id]:nth-child(6) .client-cell', { position: { x: 20, y: 10 } });
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.drawer .stepper');
  await page.click('.drawer .step button[data-value="Revue juridique"]');
  await settle();
  eq((await contractByClient('Fusion Store')).values.statut, 'Revue juridique', 'statut via les étapes');
  await page.click('.drawer [data-act="close"]');
});

await step('Pipeline : déplacement d’une carte par son menu', async () => {
  await page.click('a[data-route="pipeline"]');
  await page.waitForSelector('.kcard');
  const id = await store((s) => s.state.list.find((c) => c.values.client === 'Granit Télécom').id);
  await page.click(`.kcard[data-id="${id}"] .kcard-menu`);
  await page.click('.menu-item:has-text("En signature")');
  await settle();
  eq((await contractByClient('Granit Télécom')).values.statut, 'En signature', 'statut déplacé');
  assert(await page.isVisible(`.kcol[data-status="En signature"] .kcard[data-id="${id}"]`), 'carte dans la bonne colonne');
});

await step('Pipeline : glisser-déposer', async () => {
  const id = await store((s) => s.state.list.find((c) => c.values.client === 'Iris Online').id);
  await page.dragAndDrop(`.kcard[data-id="${id}"]`, '.kcol[data-status="Revue juridique"] .kcol-body');
  await settle();
  eq((await contractByClient('Iris Online')).values.statut, 'Revue juridique', 'statut après glisser-déposer');
});

await step('Échéancier : report d’une échéance', async () => {
  await page.click('a[data-route="echeancier"]');
  await page.waitForSelector('.agenda-item');
  const first = page.locator('.agenda-col.tone-late .agenda-item').first();
  const id = await first.getAttribute('data-open');
  await first.hover();
  await first.locator('[data-postpone]').click();
  await page.click('.menu-item:has-text("+ 1 semaine")');
  await settle();
  const due = await store((s, i) => s.getContract(i).values.echeance, id);
  eq(due, '2026-10-23', 'échéance reportée (aujourd’hui + 7 j)');
  assert((await page.$$('.g-row')).length > 40, 'diagramme de Gantt');
});

await step('Paramètres : renommer une valeur met à jour les contrats', async () => {
  await page.click('a[data-route="parametres"]');
  await page.click('[data-sec="listes"]');
  await page.click('[data-list="division"]');
  const before = await store((s) => s.state.list.filter((c) => (c.values.division || []).includes('Mobile (MX)')).length);
  assert(before > 0, 'des contrats utilisent Mobile (MX)');
  const input = page.locator('.et-row input[data-opt="value"]').first();
  await input.fill('Mobile & tablettes (MX)');
  await input.press('Tab');
  await page.click('.savebar [data-act="save"]');
  await page.waitForTimeout(500);
  const after = await store((s) => s.state.list.filter((c) => (c.values.division || []).includes('Mobile & tablettes (MX)')).length);
  eq(after, before, 'contrats mis à jour');
  const old = await store((s) => s.state.list.filter((c) => (c.values.division || []).includes('Mobile (MX)')).length);
  eq(old, 0, 'ancienne valeur disparue');
});

await step('Paramètres : permuter deux valeurs (P1 ↔ P2) ne mélange pas les contrats', async () => {
  await page.click('[data-sec="listes"]');
  await page.click('[data-list="priorite"]');
  const before = await store((s) => ({ p1: s.state.list.filter((c) => c.values.priorite === 'P1 – Critique').map((c) => c.id).sort(), p2: s.state.list.filter((c) => c.values.priorite === 'P2 – Haute').map((c) => c.id).sort() }));
  const inputs = page.locator('.et-row input[data-opt="value"]');
  await inputs.nth(0).fill('tmp'); await inputs.nth(0).press('Tab');
  await inputs.nth(1).fill('P1 – Critique'); await inputs.nth(1).press('Tab');
  await inputs.nth(0).fill('P2 – Haute'); await inputs.nth(0).press('Tab');
  await page.click('.savebar [data-act="save"]');
  await page.waitForTimeout(600);
  const after = await store((s) => ({ p1: s.state.list.filter((c) => c.values.priorite === 'P1 – Critique').map((c) => c.id).sort(), p2: s.state.list.filter((c) => c.values.priorite === 'P2 – Haute').map((c) => c.id).sort() }));
  eq(after.p2, before.p1, 'anciens P1 devenus P2');
  eq(after.p1, before.p2, 'anciens P2 devenus P1');
});

await step('Paramètres : ajout d’une colonne personnalisée', async () => {
  await page.click('[data-sec="colonnes"]');
  await page.click('[data-act="add-col"]');
  const inputs = page.locator('.col-table input[data-col="label"]');
  await inputs.last().fill('Remise de fin d’année (%)');
  await page.locator('.col-table .et-row').last().locator('select[data-col="type"]').selectOption('number');
  await page.click('.savebar [data-act="save"]');
  await page.waitForTimeout(400);
  const col = await store((s) => s.state.settings.columns.find((c) => c.label === 'Remise de fin d’année (%)'));
  assert(col && col.type === 'number', 'colonne enregistrée');
});

await step('Import Excel (mise à jour + création + nouvelle colonne)', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Suivi 2027');
  ws.addRow(['Fichier de suivi — saison 2027']);
  ws.addRow([]);
  ws.addRow(['Client', 'Statut', 'Date envoi CGV', 'Contract manager', 'Commentaire', 'Code interne']);
  ws.addRow(['Alto Distribution', 'Négociation en cours', new Date(Date.UTC(2026, 9, 5)), 'Camille Laurent', 'Mis à jour par import', 'A-01']);
  ws.addRow(['Nouveau Client SAS', 'CGV envoyées', '12/10/2026', 'Julien Moreau', 'Créé par import', 'N-77']);
  const file = join(tmp, 'import.xlsx');
  await wb.xlsx.writeFile(file);
  await page.click('[data-sec="donnees"]');
  await page.click('[data-act="import"]');
  await page.setInputFiles('.dropzone input[type="file"]', file);
  await page.waitForSelector('.map-table');
  const mapped = await page.$$eval('.map-table select', (sels) => sels.map((s) => s.value));
  eq(mapped.slice(0, 5), ['client', 'statut', 'dateCgv', 'cm', 'commentaires'], 'correspondance automatique');
  eq(mapped[5], '__new__', 'nouvelle colonne proposée');
  await page.check('input[name="mode"][value="update"]');
  await page.click('.modal-foot [data-act="go"]');
  await page.waitForSelector('.import-done');
  await page.click('.modal-foot [data-act="close"]');
  const alto = await contractByClient('Alto Distribution');
  eq([alto.values.statut, alto.values.dateCgv, alto.values.commentaires], ['Négociation en cours', '2026-10-05', 'Mis à jour par import'], 'contrat mis à jour');
  const neu = await contractByClient('Nouveau Client SAS');
  assert(neu, 'contrat créé');
  eq([neu.values.dateCgv, neu.values.cm, neu.values.ref], ['2026-10-12', 'cm2', 'SC27-043'], 'contrat créé typé et numéroté');
  const code = await store((s) => s.state.settings.columns.find((c) => c.label === 'Code interne'));
  assert(code && neu.values[code.key] === 'N-77', 'colonne créée et remplie');
});

await step('Import : un fichier protégé par le DRM Samsung est expliqué', async () => {
  const file = join(tmp, 'drm.xlsm');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, Buffer.concat([Buffer.from('<## NASCA DRM FILE - VER1.00 ##>'), Buffer.alloc(200, 7)]));
  await page.click('a[data-route="suivi"]');
  await page.click('[data-act="import"]');
  await page.setInputFiles('.dropzone input[type="file"]', file);
  await page.waitForSelector('.import-error');
  const msg = await page.textContent('.import-error');
  assert(msg.includes('DRM'), 'message DRM');
  await page.keyboard.press('Escape');
});

await step('Collage depuis Excel dans l’assistant d’import', async () => {
  await page.click('[data-act="import"]');
  await page.click('[data-src="paste"]');
  await page.fill('.paste-area', 'Enseigne\tCanal\tPriorité\nCollé SA\tE-commerce\tP3\n');
  await page.click('[data-act="paste-next"]');
  await page.waitForSelector('.map-table');
  await page.click('.modal-foot [data-act="go"]');
  await page.waitForSelector('.import-done');
  await page.click('.modal-foot [data-act="close"]');
  const c = await contractByClient('Collé SA');
  eq([c.values.canal, c.values.priorite], ['E-commerce', 'P3 – Normale'], 'valeurs reconnues');
});

await step('Export Excel mis en forme', async () => {
  await page.click('a[data-route="suivi"]');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => { await page.click('.filterbar [data-act="export"]'); await page.click('.menu-item:has-text("tous les contrats")'); })(),
  ]);
  const path = join(tmp, download.suggestedFilename());
  await download.saveAs(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  eq(wb.worksheets.map((w) => w.name), ['Suivi', 'Tableau de bord', 'Journal', 'Listes'], 'feuilles');
  const ws = wb.getWorksheet('Suivi');
  eq(ws.getCell('B4').value, 'Client / Enseigne', 'en-tête');
  const n = await store((s) => s.state.list.length);
  eq(ws.actualRowCount, 3 + n, 'lignes exportées (titre + sous-titre + en-tête + contrats)');
  assert(ws.dataValidations.model && Object.keys(ws.dataValidations.model).length > 0, 'listes déroulantes');
  assert(download.suggestedFilename().endsWith('.xlsx'), 'extension');
});

await step('Sauvegarde .json puis restauration', async () => {
  await page.click('a[data-route="parametres"]');
  await page.click('[data-sec="donnees"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
  const path = join(tmp, 'backup.json');
  await download.saveAs(path);
  const data = JSON.parse(await readFile(path, 'utf8'));
  const n = data.contracts.length;
  await store((s) => s.clearAll());
  await settle();
  eq(await store((s) => s.state.list.length), 0, 'tout supprimé');
  await page.setInputFiles('input[data-act="restore"]', path);
  await page.fill('.modal input[type="text"]', 'RESTAURER');
  await page.click('#confirm-ok');
  await page.waitForTimeout(500);
  eq(await store((s) => s.state.list.length), n, 'restauré');
});

await step('Journal : toutes les actions sont tracées', async () => {
  await page.click('a[data-route="journal"]');
  await page.waitForSelector('.j-row');
  const n = await page.$$eval('.j-row', (r) => r.length);
  assert(n > 20, `entrées du journal (${n})`);
  await page.selectOption('[data-f="type"]', 'comment');
  await settle();
  assert(await page.isVisible('.j-row:has-text("Point fait avec le KAM.")'), 'commentaire au journal');
});

await step('Thème sombre', async () => {
  await page.click('#theme-btn');
  eq(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'thème');
  await page.click('#theme-btn');
});

await step('Mobile : navigation par le menu', async () => {
  const m = await context.newPage();
  watchErrors(m, errors);
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(`${base}#/suivi`);
  await m.waitForSelector('.grid');
  await m.click('#menu-btn');
  await m.click('a[data-route="pipeline"]');
  await m.waitForSelector('.kcard');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `pas de défilement horizontal de la page (${overflow}px)`);
  await m.close();
});

await step('Aucune erreur dans la console', async () => {
  eq(errors, [], 'erreurs');
});

const failures = summary();
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
