// Tests de bout en bout en mode local (sans dépôt GitHub) : tableau de bord, comptes clients et fiche compte,
// vue tableur, automatisations (REPORT GEN déduit de l'étape, horodatage), tri des comptes, reportings,
// e-mail du vendredi, paramètres, import / export Excel, sauvegarde, journal, mobile.
// Lancement : npm run test:e2e
import ExcelJS from 'exceljs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
const base = `${server.url}?local=1&today=${TODAY}`;
const tmp = await mkdtemp(join(tmpdir(), 'suivi-e2e-'));

const store = (fn, arg) => page.evaluate(([f, a]) => (0, eval)(`(${f})`)(window.__app.store, a), [fn.toString(), arg]);
const row = (client, division) => store((s, [c, d]) => s.state.list.find((x) => x.values.client === c && (!d || x.values.division === d)), [client, division]);
const settle = () => page.waitForTimeout(250);
const total = () => store((s) => s.state.list.length);
const go = async (route) => { await page.evaluate((r) => window.__app.navigate(r), route); await settle(); };
const colIdx = (key) => page.$eval(`th[data-key="${key}"]`, (e) => Number(e.dataset.c));
const cell = async (n, key) => `tbody tr[data-id]:nth-child(${n}) td[data-c="${await colIdx(key)}"]`;
const GEN = await (async () => { await page.goto(base); await page.waitForSelector('.shell'); return page.evaluate(() => window.__app.store.state.settings.lists.statut.map((o) => o.value)); })();
const DIV = await page.evaluate(() => window.__app.store.state.settings.lists.reportDiv.map((o) => o.value));
const accountUrl = (name) => `compte/${encodeURIComponent(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase())}`;

console.log('Tests de bout en bout — mode local');

await page.evaluate(() => localStorage.clear());
await page.goto(base);
await page.waitForSelector('.shell');

await step('Accueil vide : invite à importer le fichier Suivi CM ou à essayer la démonstration', async () => {
  await page.waitForSelector('.start-card');
  assert(await page.isVisible('[data-act="start-import"]'), 'bouton import');
  assert(await page.isVisible('[data-act="start-demo"]'), 'bouton démo');
});

await step('Démonstration : 62 lignes fictives, compte à rebours et dossiers par phase', async () => {
  await page.click('[data-act="start-demo"]');
  await page.waitForSelector('.hero-count-num');
  await page.waitForFunction(() => !document.querySelector('.start-card'));
  eq(await store((s) => s.state.list.length), 62, 'lignes');
  eq((await page.textContent('.hero-count-num')).trim(), 'J-136', 'J-136 avant le 1er mars');
  const signed = await store((s) => s.state.list.filter((c) => s.state.derived.get(c.id).stage === 'done').length);
  eq(Number((await page.textContent('.phase-strip [data-phase="done"] .ps-num')).trim()), signed, 'dossiers signés');
});

await step('Accueil : notes partagées modifiables', async () => {
  await page.click('[data-note="homeNotes"] [data-act="edit-note"]');
  await page.fill('[data-note="homeNotes"] textarea', 'Point d’équipe lundi 10 h.');
  await page.click('[data-note="homeNotes"] [data-act="save-note"]');
  await settle();
  eq(await store((s) => s.state.settings.homeNotes), 'Point d’équipe lundi 10 h.', 'note enregistrée');
});

await step('Tableau de bord : étapes REPORT PAR DIV, divisions, équipe, dossiers à surveiller', async () => {
  eq(await page.$$eval('.steps-chart .sc-bar', (b) => b.length), DIV.length, 'une barre par étape');
  const total = await page.$$eval('.steps-chart .sc-n', (n) => n.reduce((a, x) => a + (Number(x.textContent) || 0), 0));
  const tracked = await store((s) => s.state.list.filter((c) => ['todo', 'active', 'signature', 'done'].includes(s.state.derived.get(c.id).stage)).length);
  eq(total, tracked, 'dossiers répartis par étape');
  assert((await page.$$('.div-bars .db-row')).length >= 8, 'barres par division');
  eq((await page.$$('.team-cards .team-card')).length, 2, 'deux CM');
  assert((await page.$$('.watch-list .watch-item')).length > 0, 'dossiers à surveiller');
  await page.click('.team-cards .team-card');
  await page.waitForSelector('.acc-list .acc-row');
  const cm = await store((s) => s.state.prefs.accounts.cm);
  const ok = await store((s, id) => [...document.querySelectorAll('.acc-row')].length > 0 && id, cm);
  assert(ok, 'comptes du CM');
});

await step('Comptes clients : un compte par client, divisions visuelles, filtres et recherche', async () => {
  await store((s) => s.setPrefs({ accounts: {} }));
  await go('comptes');
  await page.waitForSelector('.acc-row');
  const clients = await store((s) => new Set(s.state.list.filter((c) => !s.state.derived.get(c.id).closed).map((c) => c.values.client)).size);
  eq((await page.$$('.acc-row')).length, clients, 'comptes ouverts');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, 'aucun défilement horizontal');
  await page.fill('.acc-toolbar input[type="search"]', 'granit telecom');
  await page.waitForTimeout(500);
  eq((await page.$$('.acc-row')).length, 1, 'recherche sans accents');
  eq(await page.$$eval('.acc-row .div-pill', (p) => p.length), await store((s) => s.state.list.filter((c) => c.values.client === 'GRANIT TÉLÉCOM' && !s.state.derived.get(c.id).closed).length), 'une pastille par division');
  await page.fill('.acc-toolbar input[type="search"]', '');
  await page.waitForTimeout(400);
  await page.click('.phase-strip [data-phase="done"]');
  await settle();
  const withSigned = await store((s) => new Set(s.state.list.filter((c) => s.state.derived.get(c.id).stage === 'done' && !s.state.derived.get(c.id).closed).map((c) => c.values.client)).size);
  eq((await page.$$('.acc-row')).length, withSigned, 'filtre « signés »');
  await page.click('.phase-strip [data-phase=""]');
  await page.selectOption('select[data-f="division"]', 'TE');
  await settle();
  const te = await store((s) => new Set(s.state.list.filter((c) => c.values.division === 'TE' && !s.state.derived.get(c.id).closed).map((c) => c.values.client)).size);
  eq((await page.$$('.acc-row')).length, te, 'filtre division TE');
  await store((s) => s.setPrefs({ accounts: {} }));
});

await step('Fiche compte : clic sur une étape → REPORT GEN déduit automatiquement', async () => {
  await settle();
  await page.click('.acc-row[data-key="arcade numerique"]');
  await page.waitForSelector('.dv-card');
  eq((await page.$$('.dv-card')).length, 2, 'deux divisions');
  const id = await page.$eval('.dv-card', (e) => e.dataset.id);
  await page.click(`.dv-card[data-id="${id}"] .tk-step[data-step="${DIV[3]}"]`);
  await settle();
  const v = await store((s, i) => s.getContract(i).values, id);
  eq([v.reportDiv, v.statut, v.statutModifieLe], [DIV[3], '3.Attente accord client sur contrat SEF', TODAY], 'étape, REPORT GEN et horodatage');
  assert((await page.textContent(`.dv-card[data-id="${id}"] .dv-step-btn`)).includes('Revue Client'), 'étape affichée');
  await page.click(`.dv-card[data-id="${id}"] [data-act="step"]`);
  await page.click(`.step-picker [data-step="${DIV[9]}"]`);
  await settle();
  eq(await store((s, i) => s.getContract(i).values.statut, id), '7.Attente Mise en signature', 'choix dans la liste des étapes');
});

await step('Fiche compte : jalon, CM, note de suivi, champ client commun à toutes les divisions', async () => {
  const id = await page.$eval('.dv-card', (e) => e.dataset.id);
  await page.click(`.dv-card[data-id="${id}"] [data-jalon="signatureClient"]`);
  await page.waitForSelector('.cal');
  await page.fill('.cal-input input', '12/10/2026');
  await page.keyboard.press('Enter');
  await settle();
  eq(await store((s, i) => s.getContract(i).values.signatureClient, id), '2026-10-12', 'jalon daté');
  const note = page.locator(`.dv-card[data-id="${id}"] .dv-note textarea`);
  await note.fill('Relance téléphonique faite avec le signataire.');
  await note.blur();
  await settle();
  eq(await store((s, i) => s.getContract(i).values.suiviCm, id), 'Relance téléphonique faite avec le signataire.', 'note de suivi');
  const gerp = page.locator('.acc-side [data-key="codeGerp"] input');
  await gerp.fill('GERP-777');
  await gerp.press('Enter');
  await settle();
  eq(await store((s) => s.state.list.filter((c) => c.values.client === 'ARCADE NUMÉRIQUE').map((c) => c.values.codeGerp)), ['GERP-777', 'GERP-777'], 'code GERP appliqué aux deux divisions');
});

await step('Fiche compte : ajout d’une division, commentaire, renommage du client', async () => {
  await page.click('[data-act="add-div"]');
  await page.fill('.picker-search input', 'OC');
  await page.keyboard.press('Enter');
  await settle();
  const rows = await store((s) => s.state.list.filter((c) => c.values.client === 'ARCADE NUMÉRIQUE'));
  eq(rows.length, 3, 'division ajoutée');
  const oc = rows.find((c) => c.values.division === 'OC');
  eq([oc.values.codeGerp, oc.values.cm], ['GERP-777', rows[0].values.cm], 'infos client et CM reprises');
  await page.fill('.acc-side .composer textarea', 'Point fait avec le KAM.');
  await page.click('.acc-side .composer button[type="submit"]');
  await settle();
  assert(await page.isVisible('.comment-list .comment:has-text("Point fait avec le KAM.")'), 'commentaire publié');
  page.once('dialog', () => {});
  await page.click('[data-act="rename"]');
  await page.fill('.modal input', 'ARCADE NUMÉRIQUE SAS');
  await page.keyboard.press('Enter');
  await settle();
  eq(await store((s) => s.state.list.filter((c) => c.values.client === 'ARCADE NUMÉRIQUE SAS').length), 3, 'renommé sur toutes les divisions');
  assert(page.url().includes('arcade%20numerique%20sas'), 'adresse mise à jour');
  await page.click('.back-link');
  await page.waitForSelector('.acc-row');
});

await step('Vue tableur : toutes les lignes, colonnes figées alignées, bandeau des thématiques', async () => {
  await go('tableur');
  await page.waitForSelector('table.grid tbody tr[data-id]');
  eq((await page.$$('table.grid tbody tr[data-id]')).length, await total(), 'lignes');
  const th = await page.$eval('th[data-key="client"]', (e) => e.getBoundingClientRect().left);
  const td = await page.$eval(`tbody tr[data-id] td[data-c="${await colIdx('client')}"]`, (e) => e.getBoundingClientRect().left);
  assert(Math.abs(th - td) < 1, `alignement client (th ${th} / td ${td})`);
  const bands = await page.$$eval('.band-row th.band span', (s) => s.map((x) => x.textContent.trim()).filter(Boolean));
  eq(bands.filter((b) => /cl[ée]/i.test(b)).length, 1, 'thématique « Clé » affichée une fois');
  assert(bands.some((b) => /pilotage/i.test(b)), 'thématique Pilotage visible en vue suivi');
});

await step('Vue suivi / Tout afficher / Tout replier / thématique à la demande', async () => {
  assert(!(await page.$('th[data-key="receptionCc"]')), 'jalons masqués en vue suivi');
  await page.click('[data-preset="tout"]');
  await settle();
  assert(await page.$('th[data-key="receptionCc"]'), 'jalons affichés');
  assert(await page.$('th[data-key="siege"]'), 'juridique affiché');
  await page.click('[data-preset="replier"]');
  await settle();
  eq(await page.$$eval('thead tr.head-row th[data-key]', (t) => t.length), 5, 'seules les colonnes clés');
  await page.click('[data-preset="suivi"]');
  await page.click('[data-grp="jalons"]');
  await settle();
  assert(await page.$('th[data-key="receptionCc"]'), 'thématique Jalons ajoutée');
  await page.click('[data-grp="jalons"]');
  await settle();
});

await step('Mise en forme conditionnelle : signé en vert, compte fermé grisé', async () => {
  const signedId = await store((s) => s.state.list.find((c) => s.state.derived.get(c.id).stage === 'done' && !s.state.derived.get(c.id).closed).id);
  const cls = await page.$eval(`tr[data-id="${signedId}"] td[data-c="${await colIdx('statut')}"]`, (e) => e.className);
  assert(cls.includes('tone-success'), `REPORT GEN signé en vert (${cls})`);
  const closed = await store((s) => s.state.list.find((c) => s.state.derived.get(c.id).closed).id);
  assert(await page.$eval(`tr[data-id="${closed}"]`, (e) => e.classList.contains('is-closed')), 'ligne fermée grisée');
});

await step('Saisie directe au clavier puis Tab', async () => {
  await page.click(await cell(2, 'kam'));
  await page.keyboard.type('Nouveau KAM');
  await page.keyboard.press('Tab');
  await settle();
  eq((await row('ALTO DISTRIBUTION', 'DA')).values.kam, 'Nouveau KAM', 'KAM saisi');
});

await step('Étape REPORT PAR DIV par la liste déroulante : REPORT GEN et « Statut modifié le » automatiques', async () => {
  const id = (await row('ALTO DISTRIBUTION', 'AV')).id;
  await store((s, i) => s.bulkUpdate([i], { statutModifieLe: '2026-09-01' }, { automations: false }), id);
  await settle();
  await page.click(await cell(1, 'reportDiv'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.picker');
  await page.fill('.picker-search input', 'approval');
  await page.click(`.picker-opt:has-text("${DIV[8]}")`);
  await settle();
  const c = await row('ALTO DISTRIBUTION', 'AV');
  eq([c.values.reportDiv, c.values.statut, c.values.statutModifieLe], [DIV[8], GEN[5], TODAY], 'étape, REPORT GEN déduit, horodatage');
});

await step('Annulation (Ctrl+Z) : statut et horodatage rétablis', async () => {
  await page.focus('.grid-scroll');
  await page.keyboard.press('Control+z');
  await settle();
  const c = await row('ALTO DISTRIBUTION', 'AV');
  assert(c.values.reportDiv !== DIV[8] && c.values.statut !== GEN[5], 'étape et REPORT GEN rétablis');
  eq(c.values.statutModifieLe, '2026-09-01', 'horodatage rétabli');
});

await step('Jalon : calendrier français, saisie « 01/12 »', async () => {
  await page.click('[data-grp="jalons"]');
  await settle();
  await page.click(await cell(3, 'receptionCc'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cal');
  assert(/[a-zé]+ 20\d\d/.test(await page.textContent('.cal-title')), 'mois en français');
  await page.fill('.cal-input input', '01/12');
  await page.keyboard.press('Enter');
  await settle();
  eq((await row('ALTO DISTRIBUTION', 'TE')).values.receptionCc, '2026-12-01', 'date');
  assert((await page.textContent(await cell(3, 'receptionCc'))).includes('01/12/2026'), 'affichage jj/mm/aaaa');
  await page.click('[data-grp="jalons"]');
  await settle();
});

await step('Collage d’un bloc copié depuis Excel (2 × 2), valeurs de liste reconnues', async () => {
  const kam = await colIdx('kam');
  eq(await colIdx('divLeader'), kam + 1, 'DIV Leader juste après KAM');
  await page.click(`tbody tr[data-id]:nth-child(4) td[data-c="${kam}"]`);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Anne K.\tall\r\nBruno L.\tX\r\n');
    document.querySelector('.grid-scroll').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await settle();
  const a = await row('BRIO ÉLECTRO', 'AV');
  const b = await row('BRIO ÉLECTRO', 'DA');
  eq([a.values.kam, a.values.divLeader], ['Anne K.', 'ALL'], 'ligne 1');
  eq([b.values.kam, b.values.divLeader], ['Bruno L.', 'X'], 'ligne 2');
});

await step('Copie d’une plage au format Excel (TSV)', async () => {
  const kam = await colIdx('kam');
  await page.click(`tbody tr[data-id]:nth-child(4) td[data-c="${kam}"]`);
  await page.click(`tbody tr[data-id]:nth-child(5) td[data-c="${kam + 1}"]`, { modifiers: ['Shift'] });
  const text = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.querySelector('.grid-scroll').dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true }));
    return dt.getData('text/plain');
  });
  eq(text, 'Anne K.\tALL\nBruno L.\tX', 'TSV copié');
});

await step('Recherche sans accents et raccourcis (à surveiller, signés)', async () => {
  await page.fill('.filterbar input[type="search"]', 'brio electro');
  await page.waitForTimeout(400);
  eq((await page.$$('tbody tr[data-id]')).length, 2, '« brio electro »');
  await page.fill('.filterbar input[type="search"]', '');
  await page.waitForTimeout(400);
  for (const [q, test] of [['stade', (d) => !!d.stadeLevel], ['signes', (d) => d.stage === 'done']]) {
    await page.click(`.quick [data-quick="${q}"]`);
    await settle();
    const expected = await store((s, f) => s.state.list.filter((c) => (0, eval)(`(${f})`)(s.state.derived.get(c.id))).length, test.toString());
    eq(await page.$$eval('tbody tr[data-id]', (r) => r.length), expected, q);
  }
  await page.click('.quick [data-quick=""]');
  await settle();
  eq((await page.$$('tbody tr[data-id]')).length, await total(), 'retour à « Tous »');
});

await step('Filtre de colonne (façon Excel) sur la division', async () => {
  await page.hover('th[data-key="division"]');
  await page.click('th[data-key="division"] .th-filter');
  await page.waitForSelector('.colfilter');
  await page.click('.colfilter [data-all]');
  await page.click('.colfilter-opt:has-text("TE") input');
  await page.click('.colfilter [data-ok]');
  await settle();
  const expected = await store((s) => s.state.list.filter((c) => c.values.division === 'TE').length);
  eq(await page.$$eval('tbody tr[data-id]', (r) => r.length), expected, 'lignes TE');
  await page.hover('th[data-key="division"]');
  await page.click('th[data-key="division"] .th-filter');
  await page.click('.colfilter [data-clear]');
  await settle();
  eq((await page.$$('tbody tr[data-id]')).length, await total(), 'filtre retiré');
});

await step('Regroupement par CM référent', async () => {
  await page.click('[data-act="group"]');
  await page.click('.menu-item:has-text("CM référent")');
  await settle();
  assert((await page.$$('.group-row')).length >= 2, 'groupes affichés');
  await page.click('[data-act="group"]');
  await page.click('.menu-item:has-text("Aucun regroupement")');
  await settle();
  eq((await page.$$('.group-row')).length, 0, 'regroupement retiré');
});

await step('Sélection multiple et modification groupée (juriste)', async () => {
  await page.click('tbody tr[data-id]:nth-child(1) input[data-row]');
  await page.click('tbody tr[data-id]:nth-child(2) input[data-row]');
  await page.waitForSelector('.bulkbar:not([hidden])');
  await page.click('.bulkbar [data-bulk="juriste"]');
  await page.click('.picker-opt:has-text("Thomas Bernard")');
  await settle();
  eq([(await row('ALTO DISTRIBUTION', 'AV')).values.juriste, (await row('ALTO DISTRIBUTION', 'DA')).values.juriste], ['Thomas Bernard', 'Thomas Bernard'], 'juristes');
  await page.click('.bulkbar [data-act="bulk-clear"]');
});

await step('Macro « Trier les comptes » : fermés en bas puis renumérotation', async () => {
  await page.click('[data-act="sort-accounts"]');
  await page.click('#confirm-ok');
  await page.waitForTimeout(600);
  const order = await store((s) => s.state.list.slice().sort((a, b) => Number(a.values.ref) - Number(b.values.ref)).map((c) => s.state.derived.get(c.id).closed));
  const firstClosed = order.indexOf(true);
  assert(firstClosed > 0 && order.slice(firstClosed).every(Boolean), 'comptes fermés regroupés en bas');
  const refs = await store((s) => s.state.list.map((c) => Number(c.values.ref)).sort((a, b) => a - b));
  const n = await total();
  eq(refs, Array.from({ length: n }, (_, i) => i + 1), 'références 1 à N');
});

await step('Fiche complète d’une ligne : champs par thématique, commentaire, historique', async () => {
  await page.hover('tbody tr[data-id]:nth-child(1)');
  await page.click('tbody tr[data-id]:nth-child(1) .open-btn');
  await page.waitForSelector('.drawer .field-row');
  assert(page.url().includes('?c='), 'lien direct dans l’adresse');
  const id = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('c'));
  const kam = page.locator('.drawer .field-row[data-key="kam"] input');
  await kam.fill('Claire Dupont');
  await kam.press('Enter');
  await settle();
  eq(await store((s, i) => s.getContract(i).values.kam, id), 'Claire Dupont', 'KAM');
  await page.click('.drawer .tab[data-tab="comments"]');
  await page.fill('.composer textarea', 'Point fait avec le KAM.');
  await page.click('.composer button[type="submit"]');
  await settle();
  assert(await page.isVisible('.comment:has-text("Point fait avec le KAM.")'), 'commentaire');
  await page.click('.drawer .tab[data-tab="history"]');
  await settle();
  assert(await page.isVisible('.tl-item:has-text("Claire Dupont")'), 'historique');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(!page.url().includes('?c='), 'fiche fermée');
});

await step('Fiche complète : étapes REPORT PAR DIV cliquables', async () => {
  await page.hover('tbody tr[data-id]:nth-child(6)');
  await page.click('tbody tr[data-id]:nth-child(6) .open-btn');
  await page.waitForSelector('.drawer .stepper');
  const id = await page.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('c'));
  await page.click(`.drawer .step button[data-value="${DIV[6]}"]`);
  await settle();
  eq(await store((s, i) => [s.getContract(i).values.reportDiv, s.getContract(i).values.statut], id), [DIV[6], GEN[3]], 'étape et REPORT GEN');
  await page.click('.drawer [data-act="close"]');
});

await step('Reporting général : synthèse, tableau cohérent, graphique en anglais', async () => {
  await go('reporting/tableau');
  await page.waitForSelector('.report-tab');
  const k = await store((s) => s.state.list.filter((c) => ['todo', 'active', 'signature', 'done'].includes(s.state.derived.get(c.id).stage)).length);
  const total = await page.$eval('.report-tab tbody tr:first-child td.is-total', (td) => Number(td.textContent.trim()));
  eq(total, k, 'TOTAL SEF = contrats / PAF attendus');
  assert(await page.isVisible('.check-line.ok'), 'contrôle de cohérence OK');
  await page.click('[data-lang="en"]');
  await go('reporting/graphique');
  assert(await page.isVisible('text=SMARTPHONES'), 'libellés anglais des divisions');
  assert(await page.isVisible('text=DIV STATUS REPORT'), 'titre anglais');
  await page.click('[data-lang="fr"]');
  await settle();
});

await step('Reporting par division : filtre et dossiers de la sélection', async () => {
  await go('divisions');
  await page.waitForSelector('.div-filters');
  await page.selectOption('.div-filters [data-f="group"]', 'TE');
  await settle();
  const n = await store((s) => s.state.list.filter((c) => c.values.division === 'TE').length);
  assert((await page.textContent('.report-card')).includes(`${n} ligne`), `${n} lignes TE`);
  const open = await store((s) => s.state.list.filter((c) => c.values.division === 'TE' && !s.state.derived.get(c.id).closed).length);
  eq((await page.$$('.dossier-list .dossier-row')).length, open, 'dossiers TE');
  await page.selectOption('.div-filters [data-f="group"]', '');
  await settle();
});

await step('Paramètres : renommer un juriste met à jour les lignes', async () => {
  await go('parametres/listes');
  await page.click('[data-list="juriste"]');
  const before = await store((s) => s.state.list.filter((c) => c.values.juriste === 'Sophie Martin').length);
  assert(before > 0, 'lignes concernées');
  const input = page.locator('.et-row input[data-opt="value"]').first();
  await input.fill('Sophie Martin-Durand');
  await input.press('Tab');
  await page.click('.savebar [data-act="save"]');
  await page.waitForTimeout(500);
  eq(await store((s) => s.state.list.filter((c) => c.values.juriste === 'Sophie Martin-Durand').length), before, 'lignes mises à jour');
});

await step('Paramètres : ajout d’une colonne personnalisée', async () => {
  await page.click('[data-sec="colonnes"]');
  await page.click('[data-act="add-col"]');
  await page.locator('.col-table input[data-col="label"]').last().fill('Remise de fin d’année');
  await page.locator('.col-table .et-row').last().locator('select[data-col="type"]').selectOption('number');
  await page.click('.savebar [data-act="save"]');
  await page.waitForTimeout(400);
  const col = await store((s) => s.state.settings.columns.find((c) => c.label === 'Remise de fin d’année'));
  assert(col && col.type === 'number', 'colonne enregistrée');
});

await step('Import d’un classeur au format « Suivi CM » (mise à jour + création)', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('1.Suivi CM');
  ws.addRow(['Suivi Contract Management — Contrats clients']);
  ws.addRow([]);
  ws.addRow(['CLÉ', 'CLÉ', 'CLÉ', 'CLÉ', 'ÉQUIPE', 'ÉQUIPE', 'SUIVI', 'SUIVI', 'SUIVI', 'JALONS', 'JALONS']);
  ws.mergeCells('A3:D3'); ws.mergeCells('E3:F3'); ws.mergeCells('G3:I3'); ws.mergeCells('J3:K3');
  ws.addRow(['Réf.', 'CLIENT', 'DIVISION', 'Statut du compte 2027', 'CM référent', 'JURISTE', 'REPORT GEN', 'Alerte (auto)', 'Code maison', 'Réception CC', 'Durée revue (j, auto)']);
  ws.addRow([1, 'ALTO DISTRIBUTION', 'AV', 'Actif', 'Camille Laurent', 'Hugo Roux (cabinet)', GEN[3], 'Relance échue', 'A-01', new Date(Date.UTC(2026, 9, 5)), 3]);
  ws.addRow([99, 'NOUVEAU CLIENT SAS', 'MO (LED)', 'Nouveau', 'Julien Moreau', 'Nina Leroy', GEN[0], '', 'N-77', '12/10/2026', '']);
  const file = join(tmp, 'Suivi_CM.xlsx');
  await wb.xlsx.writeFile(file);
  await go('parametres/donnees');
  await page.click('[data-act="import"]');
  await page.setInputFiles('.dropzone input[type="file"]', file);
  await page.waitForSelector('.map-table');
  const mapped = await page.$$eval('.map-table select', (sels) => sels.map((s) => s.value));
  eq(mapped, ['ref', 'client', 'division', 'statutCompte', 'cm', 'juriste', 'statut', '', '__new__', 'receptionCc', ''], 'correspondance (colonnes auto ignorées)');
  await page.check('input[name="mode"][value="update"]');
  await page.click('.modal-foot [data-act="go"]');
  await page.waitForSelector('.import-done');
  await page.click('.modal-foot [data-act="close"]');
  const alto = await row('ALTO DISTRIBUTION', 'AV');
  eq([alto.values.statut, alto.values.receptionCc, alto.values.juriste], [GEN[3], '2026-10-05', 'Hugo Roux (cabinet)'], 'ligne mise à jour');
  const neu = await row('NOUVEAU CLIENT SAS');
  assert(neu, 'ligne créée');
  eq([neu.values.receptionCc, neu.values.cm, neu.values.ref, neu.values.juriste], ['2026-10-12', 'julien', '99', 'Nina Leroy'], 'ligne créée typée');
  assert(await store((s) => s.state.settings.lists.juriste.some((o) => o.value === 'Nina Leroy')), 'nouveau juriste ajouté à la liste');
  const code = await store((s) => s.state.settings.columns.find((c) => c.label === 'Code maison'));
  assert(code && neu.values[code.key] === 'N-77', 'colonne maison créée');
});

await step('Import : un fichier protégé par le DRM Samsung est expliqué', async () => {
  const file = join(tmp, 'drm.xlsm');
  await writeFile(file, Buffer.concat([Buffer.from('<## NASCA DRM FILE - VER1.00 ##>'), Buffer.alloc(200, 7)]));
  await go('tableur');
  await page.click('[data-act="import"]');
  await page.setInputFiles('.dropzone input[type="file"]', file);
  await page.waitForSelector('.import-error');
  assert((await page.textContent('.import-error')).includes('DRM'), 'message DRM');
  await page.keyboard.press('Escape');
});

await step('Collage depuis Excel dans l’assistant d’import', async () => {
  await page.click('[data-act="import"]');
  await page.click('[data-src="paste"]');
  await page.fill('.paste-area', 'CLIENT\tDIVISION\tREPORT GEN\nCOLLÉ SA\tte\t2.attente contrat client\n');
  await page.click('[data-act="paste-next"]');
  await page.waitForSelector('.map-table');
  await page.click('.modal-foot [data-act="go"]');
  await page.waitForSelector('.import-done');
  await page.click('.modal-foot [data-act="close"]');
  const c = await row('COLLÉ SA');
  eq([c.values.division, c.values.statut], ['TE', GEN[1]], 'valeurs reconnues malgré la casse');
});

await step('Export Excel : onglets du classeur, thématiques, valeurs typées', async () => {
  await go('tableur');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => { await page.click('.filterbar [data-act="export"]'); await page.click('.menu-item:has-text("toutes les lignes")'); })(),
  ]);
  const path = join(tmp, download.suggestedFilename());
  await download.saveAs(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  eq(wb.worksheets.map((w) => w.name), ['1.Suivi CM', 'Reporting général', 'Charge équipe', 'Journal', 'Listes déroulantes'], 'onglets');
  const ws = wb.getWorksheet('1.Suivi CM');
  eq(ws.getCell('B4').value, 'CLIENT', 'en-tête ligne 4 comme le classeur');
  eq(ws.getCell('A3').value, 'CLÉ', 'bandeau des thématiques');
  const n = await store((s) => s.state.list.length);
  eq(ws.actualRowCount, 4 + n, 'titre, sous-titre, bandeau, en-tête + lignes');
  assert(ws.dataValidations.model && Object.keys(ws.dataValidations.model).length > 0, 'listes déroulantes');
});

await step('Sauvegarde .json puis restauration', async () => {
  await go('parametres/donnees');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup"]')]);
  const path = join(tmp, 'backup.json');
  await download.saveAs(path);
  const data = JSON.parse(await readFile(path, 'utf8'));
  await store((s) => s.clearAll());
  await settle();
  eq(await store((s) => s.state.list.length), 0, 'tout supprimé');
  await page.setInputFiles('input[data-act="restore"]', path);
  await page.fill('.modal input[type="text"]', 'RESTAURER');
  await page.click('#confirm-ok');
  await page.waitForTimeout(600);
  eq(await store((s) => s.state.list.length), data.contracts.length, 'restauré');
});

await step('Journal : actions tracées, filtre des commentaires', async () => {
  await page.click('a[data-route="journal"]');
  await page.waitForSelector('.j-row');
  const n = await page.$$eval('.j-row', (r) => r.length);
  assert(n >= 5, `entrées du journal (${n})`);
  await page.selectOption('[data-f="type"]', 'comment');
  await settle();
  assert(await page.isVisible('.j-row:has-text("Point fait avec le KAM.")'), 'commentaire au journal');
});

await step('Suivi hebdo : réglages partagés, semaine figée, brouillon Outlook (.eml) avec images', async () => {
  const p = await context.newPage();
  watchErrors(p, errors);
  await p.goto(`${server.url}?local=1&today=2026-12-09#/hebdo`);
  await p.waitForSelector('.mail-settings');
  await p.fill('.mail-settings [data-h="to"]', 'direction.juridique@exemple.fr; equipe.cm@exemple.fr');
  await p.click('.mail-settings [data-act="save"]');
  await p.waitForTimeout(300);
  await p.click('[data-act="mail"]');
  await p.waitForSelector('.mail-preview img');
  eq(await p.$$eval('.mail-preview img', (i) => i.length), 2, 'synthèse + graphique par division');
  const frozen = await p.evaluate(() => window.__app.store.state.settings.hebdoWeeks['2026-12-04']);
  assert(frozen && frozen.attendus > 0, 'semaine du 04/12 figée');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('.modal-foot button:has-text("brouillon Outlook")')]);
  const path = join(tmp, dl.suggestedFilename());
  await dl.saveAs(path);
  const eml = await readFile(path, 'utf8');
  assert(eml.includes('X-Unsent: 1'), 's’ouvre comme un nouveau message');
  assert(eml.includes('To: direction.juridique@exemple.fr, equipe.cm@exemple.fr'), 'destinataires');
  assert(eml.includes('Content-ID: <synthese@suivi-cm>') && eml.includes('Content-ID: <graphique@suivi-cm>'), 'images intégrées');
  await p.keyboard.press('Escape');
  await p.waitForSelector('.report-table tr.row-current');
  await p.close();
});

await step('Thème sombre', async () => {
  await page.click('#theme-btn');
  eq(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'thème');
  await page.click('#theme-btn');
});

await step('Mobile : menu et écrans sans défilement horizontal de la page', async () => {
  const m = await context.newPage();
  watchErrors(m, errors);
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(`${base}#/comptes`);
  await m.waitForSelector('.acc-row');
  await m.click('#menu-btn');
  await m.click('a[data-route="accueil"]');
  await m.waitForSelector('.steps-chart');
  for (const r of ['accueil', 'comptes', accountUrl('GRANIT TÉLÉCOM'), 'reporting', 'divisions', 'hebdo', 'journal', 'parametres', 'tableur']) {
    await m.evaluate((x) => window.__app.navigate(x), r);
    await m.waitForTimeout(350);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `${r} (${overflow}px)`);
  }
  await m.close();
});

await step('Aucune erreur dans la console', async () => {
  eq(errors, [], 'erreurs');
});

const failures = summary();
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
