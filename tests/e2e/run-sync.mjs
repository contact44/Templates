// Deux personnes connectées en même temps au même dépôt GitHub de données (serveur GitHub simulé) :
// connexion par clé et par lien d'accès, initialisation du dépôt, propagation des modifications,
// modifications simultanées (même ligne, même champ), commentaires, journal, hors ligne, suppression,
// paramètres partagés, clé en lecture seule, dépôt public signalé, déconnexion.
// Lancement : npm run test:sync
import { assert, eq, launch, serve, step, summary } from './helpers.mjs';
import { startMockGitHub } from './mock-github.mjs';

const TODAY = '2026-10-16';
const REPO = 'equipe/donnees';
const mock = await startMockGitHub({
  latency: 30,
  tokens: {
    'github_pat_alice': { login: 'alice-cm', name: 'Alice Martin', email: 'alice@exemple.fr', repos: { [REPO]: 'write', 'equipe/public': 'write' } },
    'github_pat_bruno': { login: 'bruno-cm', name: 'Bruno Petit', email: 'bruno@exemple.fr', repos: { [REPO]: 'write' } },
    'github_pat_lecteur': { login: 'lecteur', name: 'Léa Lecture', email: '', repos: { [REPO]: 'read' } },
  },
  repos: { [REPO]: { private: true, defaultBranch: 'main' }, 'equipe/public': { private: false, defaultBranch: 'main' } },
});
const server = await serve();
const browser = await launch();
const appUrl = (repo = REPO) => `${server.url}?gh=${encodeURIComponent(mock.url)}&depot=${repo}&poll=500&today=${TODAY}`;
const errors = [];
const ignorable = (m) => /Failed to load resource|status of (304|401|403|404|409|422)/.test(m);

async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { context, page };
}
async function ready(page, identity) {
  await page.waitForSelector('.shell', { timeout: 15000 });
  if (identity) {
    const opt = await page.waitForSelector('.identity-opt', { timeout: 4000 }).catch(() => null);
    if (opt) { await page.click(`.identity-opt:nth-of-type(${identity})`); await page.waitForTimeout(200); }
  }
}

const get = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(`(${f})`)(window.__app.store, a), [fn.toString(), arg]);
async function until(page, fn, arg, label, timeout = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await get(page, fn, arg).catch(() => null);
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`Délai dépassé : ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const files = async (repo = REPO) => (await fetch(`${mock.url}/__admin/files?repo=${encodeURIComponent(repo)}`)).json();

console.log('Tests de bout en bout — deux personnes sur le même dépôt GitHub (simulé)');

const A = await open();
const B = await open();
let target = null; // identifiant d'une ligne partagée

await step('Connexion d’Alice par sa clé d’accès : dépôt vide initialisé', async () => {
  await A.page.goto(appUrl());
  await A.page.waitForSelector('.login-form');
  await A.page.fill('input[name="token"]', 'mauvaise-cle');
  await A.page.click('.login-form button[type="submit"]');
  await A.page.waitForSelector('.login-error:not([hidden])');
  await A.page.fill('input[name="token"]', 'github_pat_alice');
  await A.page.click('.login-form button[type="submit"]');
  await ready(A.page, 1);
  const f = await files();
  assert(Object.keys(f).some((p) => p.endsWith('suivi-cm/2027/parametres.json')), `paramètres créés dans le dépôt (${Object.keys(f).join(', ')})`);
  assert(await A.page.isVisible('text=Base partagée GitHub'), 'mode partagé affiché');
});

await step('Alice charge 62 lignes ; Bruno, arrivé par le lien d’accès, les reçoit', async () => {
  await A.page.evaluate(async () => { const { buildDemo } = await import('./assets/js/core/demo.js'); await window.__app.store.loadDemo(buildDemo); });
  await until(A.page, (s) => s.state.list.length === 62 && !s.state.backend.pendingCount(), null, 'envoi des 62 lignes', 20000);
  const f = await files();
  eq(Object.keys(f).filter((p) => p.includes('/contrats/')).length, 62, 'un fichier par ligne dans le dépôt');
  await B.page.goto(`${appUrl()}#acces=github_pat_bruno&depot=${REPO}`);
  await ready(B.page, 2);
  assert(!B.page.url().includes('acces='), 'clé retirée de l’adresse');
  await until(B.page, (s) => s.state.list.length === 62, null, 'Bruno voit les 62 lignes', 15000);
  target = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'ALTO DISTRIBUTION' && c.values.division === 'AV').id);
});

await step('Modification d’Alice visible chez Bruno en quelques secondes', async () => {
  await get(A.page, (s, id) => s.updateField(id, 'kam', 'Kam d’Alice'), target);
  const { ms } = await until(B.page, (s, id) => s.getContract(id)?.values.kam === 'Kam d’Alice', target, 'propagation');
  console.log(`    (propagation en ${ms} ms)`);
});

await step('Modifications simultanées de deux champs de la même ligne : aucune perte', async () => {
  await Promise.all([
    get(A.page, (s, id) => s.updateField(id, 'suiviCm', 'Point Alice'), target),
    get(B.page, (s, id) => s.updateField(id, 'juristesBinome', 'Binôme de Bruno'), target),
  ]);
  for (const [who, p] of [['Alice', A.page], ['Bruno', B.page]]) {
    await until(p, (s, id) => s.getContract(id)?.values.suiviCm === 'Point Alice' && s.getContract(id)?.values.juristesBinome === 'Binôme de Bruno', target, `fusion chez ${who}`);
  }
});

await step('Même champ modifié en même temps : les deux postes convergent', async () => {
  await Promise.all([
    get(A.page, (s, id) => s.updateField(id, 'juriste', 'Sophie Martin'), target),
    get(B.page, (s, id) => s.updateField(id, 'juriste', 'Thomas Bernard'), target),
  ]);
  await until(A.page, (s) => !s.state.backend.pendingCount(), null, 'envoi Alice');
  await until(B.page, (s) => !s.state.backend.pendingCount(), null, 'envoi Bruno');
  await new Promise((r) => setTimeout(r, 1500));
  const a = await get(A.page, (s, id) => s.getContract(id).values.juriste, target);
  const b = await get(B.page, (s, id) => s.getContract(id).values.juriste, target);
  eq(a, b, 'même valeur des deux côtés');
  assert(['Sophie Martin', 'Thomas Bernard'].includes(a), 'une des deux saisies');
});

await step('Rafale de créations des deux côtés : références uniques', async () => {
  await Promise.all([
    get(A.page, async (s) => { for (let i = 0; i < 4; i++) await s.createContract({ client: `RAFALE A${i}`, division: 'AV' }); }),
    get(B.page, async (s) => { for (let i = 0; i < 4; i++) await s.createContract({ client: `RAFALE B${i}`, division: 'TE' }); }),
  ]);
  await until(A.page, (s) => s.state.list.filter((c) => c.values.client?.startsWith('RAFALE')).length === 8, null, '8 lignes chez Alice', 15000);
  const t0 = Date.now();
  await until(B.page, (s) => s.state.list.filter((c) => c.values.client?.startsWith('RAFALE')).length === 8, null, '8 lignes chez Bruno', 30000)
    .catch(async (e) => { console.log(JSON.stringify(await get(B.page, (s) => ({ n: s.state.list.filter((c) => c.values.client?.startsWith('RAFALE')).map((c) => c.values.client), pend: s.state.backend.pendingCount(), sync: s.state.sync })))); console.log(JSON.stringify(await get(A.page, (s) => ({ pend: s.state.backend.pendingCount(), sync: s.state.sync })))); throw e; });
  console.log(`    (rafale reçue en ${Date.now() - t0} ms)`);
  // Deux créations simultanées peuvent prendre le même numéro : chaque poste renumérote les siennes.
  for (const [who, p] of [['Alice', A.page], ['Bruno', B.page]]) {
    await until(p, (s) => { const r = s.state.list.map((c) => c.values.ref); return new Set(r).size === r.length && !s.state.backend.pendingCount(); }, null, `références uniques chez ${who}`, 30000)
      .catch(async (e) => { console.log(JSON.stringify(await get(p, (s) => ({ u: s.state.user?.uid, sync: s.state.sync, pend: s.state.backend.pendingCount(), dup: s.state.list.filter((c, i, a) => a.some((d) => d !== c && d.values.ref === c.values.ref)).map((c) => [c.values.client, c.values.ref, c.createdBy, c.createdAt]) })))); throw e; });
  }
  const ra = await get(A.page, (s) => s.state.list.map((c) => `${c.id}:${c.values.ref}`).sort());
  await until(B.page, (s, x) => JSON.stringify(s.state.list.map((c) => `${c.id}:${c.values.ref}`).sort()) === x, JSON.stringify(ra), 'mêmes références des deux côtés', 15000);
});

await step('Commentaire de Bruno dans la fiche, visible au journal d’Alice', async () => {
  await get(B.page, (s, id) => s.addComment(id, 'Le KAM relance le client lundi.'), target);
  await until(A.page, (s) => s.state.history.some((h) => h.action === 'comment' && h.to === 'Le KAM relance le client lundi.' && h.user), null, 'commentaire au journal', 15000);
  await A.page.click('a[data-route="journal"]');
  await A.page.waitForSelector('.j-row');
  assert(await A.page.isVisible('.j-row:has-text("Le KAM relance le client lundi.")'), 'ligne du journal');
});

await step('Hors ligne : modifications conservées puis envoyées au retour du réseau', async () => {
  await B.context.setOffline(true);
  await get(B.page, (s, id) => s.updateField(id, 'receptionCc', '2026-10-30'), target);
  await B.page.waitForTimeout(800);
  assert(await get(B.page, (s) => s.state.backend.pendingCount() > 0), 'modification en attente');
  eq(await get(A.page, (s, id) => s.getContract(id).values.receptionCc ?? null, target) === '2026-10-30', false, 'pas encore chez Alice');
  await B.context.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await until(A.page, (s, id) => s.getContract(id)?.values.receptionCc === '2026-10-30', target, 'reçu après reconnexion', 15000);
});

await step('Paramètres partagés : seuils de la charge équipe', async () => {
  await get(A.page, (s) => s.saveSettings({ alerts: { ...s.state.settings.alerts, vigilanceDays: 7, blocageDays: 15 } }, 'Seuils'));
  await until(B.page, (s) => s.state.settings.alerts.vigilanceDays === 7 && s.state.settings.alerts.blocageDays === 15, null, 'seuils reçus');
  await get(B.page, (s) => s.saveSettings({ homeNotes: 'Note de Bruno' }, 'Note'));
  await until(A.page, (s) => s.state.settings.homeNotes === 'Note de Bruno' && s.state.settings.alerts.vigilanceDays === 7, null, 'note reçue sans écraser les seuils');
});

await step('Suppression par Alice pendant que Bruno modifie la même ligne', async () => {
  const id = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'RAFALE A0').id);
  await until(B.page, (s, i) => !!s.getContract(i), id, 'ligne connue de Bruno');
  await Promise.all([get(A.page, (s, i) => s.deleteContracts([i]), id), get(B.page, (s, i) => s.updateField(i, 'kam', 'Trop tard'), id)]);
  await until(A.page, (s, i) => !s.getContract(i) && !s.state.backend.pendingCount(), id, 'supprimée chez Alice');
  await until(B.page, (s, i) => !s.getContract(i) && !s.state.backend.pendingCount(), id, 'supprimée chez Bruno', 15000);
  await new Promise((r) => setTimeout(r, 1200));
  eq(await get(A.page, (s, i) => !!s.getContract(i), id), false, 'pas de résurrection');
});

await step('Clé en lecture seule : consultation possible, enregistrement refusé et conservé', async () => {
  const C = await open();
  await C.page.goto(`${appUrl()}#acces=github_pat_lecteur&depot=${REPO}`);
  await ready(C.page, 1);
  await until(C.page, (s) => s.state.list.length > 60, null, 'lecture');
  await get(C.page, (s, id) => s.updateField(id, 'kam', 'Essai lecteur'), target);
  await C.page.waitForSelector('.toast:has-text("Read and write")', { timeout: 10000 });
  assert(await get(C.page, (s) => s.state.backend.pendingCount() > 0), 'modification gardée en attente');
  eq(await get(A.page, (s, id) => s.getContract(id).values.kam, target), 'Kam d’Alice', 'rien d’écrit dans le dépôt');
  await C.context.close();
});

await step('Dépôt public : bandeau d’alerte de confidentialité', async () => {
  const D = await open();
  await D.page.goto(`${appUrl('equipe/public')}#acces=github_pat_alice&depot=equipe/public`);
  await ready(D.page, 1);
  await D.page.waitForSelector('.banner-danger');
  assert((await D.page.textContent('.banner-danger')).includes('Dépôt public'), 'texte du bandeau');
  await D.context.close();
});

await step('Journal partagé : actions des deux personnes, avec leur nom', async () => {
  await A.page.evaluate(() => window.__app.navigate('journal'));
  await A.page.waitForTimeout(1500);
  const users = await get(A.page, (s) => [...new Set(s.state.history.map((h) => h.user))]);
  assert(users.length >= 2, `au moins deux auteurs (${users.join(', ')})`);
});

await step('Déconnexion : la clé est effacée de ce navigateur', async () => {
  await B.page.click('#user-btn');
  await B.page.click('.menu-item:has-text("se déconnecter")');
  const confirm = await B.page.waitForSelector('#confirm-ok', { timeout: 1500 }).catch(() => null);
  if (confirm) await confirm.click();
  await B.page.waitForSelector('.login-form', { timeout: 10000 });
  eq(await B.page.evaluate(() => localStorage.getItem('saison:gh-token')), null, 'clé supprimée');
});

await step('Conflits réellement provoqués puis résolus par le serveur simulé', async () => {
  const stats = await (await fetch(`${mock.url}/__admin/stats`)).json();
  console.log(`    (${stats.requests} requêtes, ${stats.writes} écritures, ${stats.conflicts} conflit(s) résolu(s))`);
  assert(stats.conflicts >= 1, 'au moins un conflit d’écriture rencontré');
});

await step('Aucune erreur dans la console', async () => {
  eq(errors, [], 'erreurs');
});

const failures = summary();
await browser.close();
await server.close();
await mock.close();
process.exit(failures ? 1 : 0);
