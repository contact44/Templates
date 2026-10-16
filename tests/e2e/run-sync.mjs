// Scénario à deux utilisateurs connectés en même temps (émulateur Firebase) :
// propagation en temps réel, modifications simultanées, présence, commentaires, journal,
// mode hors ligne, suppression, et refus d'accès pour un compte non autorisé.
import { assert, eq, launch, serve, step, summary, watchErrors } from './helpers.mjs';

const TODAY = '2026-10-16';
const AUTH = 'http://127.0.0.1:9099';
const PASSWORD = 'MotDePasse!2027';

async function createUser(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  if (!r.ok) throw new Error(`Création du compte ${email} : ${r.status} ${await r.text()}`);
}

const server = await serve();
const browser = await launch();
const url = `${server.url}?emulator=1&project=demo-saison&today=${TODAY}`;
const errors = [];

async function openAs(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
  const page = await context.newPage();
  watchErrors(page, errors);
  await page.goto(url);
  await page.waitForSelector('.login-form');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('.login-form button[type="submit"]');
  return { context, page };
}

const get = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(`(${f})`)(window.__app.store, a), [fn.toString(), arg]);
async function until(page, fn, arg, label, timeout = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await get(page, fn, arg).catch(() => null);
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`Délai dépassé : ${label}`);
    await page.waitForTimeout(100);
  }
}

console.log('Tests de synchronisation — deux utilisateurs, émulateur Firebase');
// Remise à zéro de l'émulateur (comptes et données).
await fetch(`${AUTH}/emulator/v1/projects/demo-saison/accounts`, { method: 'DELETE' });
await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-saison/databases/(default)/documents', { method: 'DELETE' });
await createUser('claire@test.local');
await createUser('julien@test.local');
await createUser('intrus@test.local');

const A = await openAs('claire@test.local');
await A.page.waitForSelector('.shell', { timeout: 20000 });
const B = await openAs('julien@test.local');
await B.page.waitForSelector('.shell', { timeout: 20000 });

await step('Connexion des deux utilisateurs et création de la saison', async () => {
  eq(await A.page.textContent('.mode-pill span'), 'Base partagée', 'mode Firebase (A)');
  eq(await B.page.textContent('.mode-pill span'), 'Base partagée', 'mode Firebase (B)');
  const settingsB = await until(B.page, (s) => s.state.loaded.settings && s.state.settings.season.name, null, 'paramètres');
  eq(settingsB.value, 'Saison contractuelle 2027', 'paramètres partagés');
});

await step('Chargement de la démonstration par A, visible chez B', async () => {
  await A.page.click('button[data-act="demo"]');
  const r = await until(B.page, (s) => s.state.list.length === 42, null, '42 contrats chez B');
  console.log(`    (reçu chez B en ${r.ms} ms)`);
  const team = await get(B.page, (s) => s.state.settings.team.map((m) => m.name));
  eq(team, ['Camille Laurent', 'Julien Moreau'], 'équipe partagée');
});

await step('Associer les comptes aux membres de l’équipe (e-mail)', async () => {
  await get(A.page, (s) => s.saveSettings({ team: s.state.settings.team.map((m) => ({ ...m, email: m.id === 'cm1' ? 'claire@test.local' : 'julien@test.local' })) }));
  await until(B.page, (s) => s.me().name === 'Julien Moreau', null, 'B reconnu comme Julien Moreau');
  eq(await get(A.page, (s) => s.me().name), 'Camille Laurent', 'A reconnue comme Camille Laurent');
});

await step('Une modification de A apparaît chez B en temps réel (avec surbrillance)', async () => {
  await B.page.goto(`${url}#/suivi`);
  await B.page.waitForSelector('tbody tr[data-id]');
  const id = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'Alto Distribution').id);
  const t0 = Date.now();
  await get(A.page, (s, i) => s.updateField(i, 'groupe', 'Groupe modifié par Camille'), id);
  const own = await until(A.page, (s, i) => s.getContract(i)?.values.groupe === 'Groupe modifié par Camille', id, 'valeur chez A');
  console.log(`    (affichée chez A en ${Date.now() - t0} ms)`);
  const r = await until(B.page, (s, i) => s.getContract(i)?.values.groupe === 'Groupe modifié par Camille', id, 'valeur chez B');
  console.log(`    (propagée en ${r.ms} ms)`);
  await B.page.waitForSelector(`tr[data-id="${id}"] td.flash`, { timeout: 4000 });
  const by = await get(B.page, (s, i) => s.getContract(i).updatedByName, id);
  eq(by, 'Camille Laurent', 'auteur de la dernière modification');
});

await step('Modifications simultanées sur le même contrat : aucune perte', async () => {
  const id = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'Brio Électro').id);
  await Promise.all([
    get(A.page, (s, i) => s.updateField(i, 'kam', 'KAM saisi par Camille'), id),
    get(B.page, (s, i) => s.updateField(i, 'version', 'V9 (Julien)'), id),
  ]);
  for (const P of [A.page, B.page]) {
    await until(P, (s, i) => { const c = s.getContract(i); return c && c.values.kam === 'KAM saisi par Camille' && c.values.version === 'V9 (Julien)'; }, id, 'les deux valeurs');
  }
});

await step('Même champ modifié par les deux : la dernière écriture gagne partout', async () => {
  const id = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'Delta Hi-Fi').id);
  await get(A.page, (s, i) => s.updateField(i, 'prochaineAction', 'Version A'), id);
  await until(B.page, (s, i) => s.getContract(i).values.prochaineAction === 'Version A', id, 'A propagé');
  await get(B.page, (s, i) => s.updateField(i, 'prochaineAction', 'Version B'), id);
  await until(A.page, (s, i) => s.getContract(i).values.prochaineAction === 'Version B', id, 'B propagé chez A');
});

await step('Présence : A voit que B consulte une fiche', async () => {
  const id = await get(B.page, (s) => s.state.list.find((c) => c.values.client === 'Cobalt Hypermarchés').id);
  await B.page.evaluate((i) => window.__app.openContract(i), id);
  await B.page.waitForSelector('.drawer .field-row');
  await A.page.goto(`${url}#/suivi`);
  await A.page.waitForSelector('tbody tr[data-id]');
  await until(A.page, (s, i) => s.peers().some((p) => p.contractId === i && p.name === 'Julien Moreau'), id, 'présence de B');
  await A.page.waitForSelector('#presence .presence-av:not(.me)', { timeout: 5000 });
  await A.page.waitForSelector(`tr.peer-row[data-id="${id}"]`, { timeout: 5000 });
  eq((await A.page.textContent('.presence-label')).trim(), '2 en ligne', 'compteur de présence');
});

await step('Commentaire de B visible chez A', async () => {
  const id = await get(B.page, (s) => s.state.list.find((c) => c.values.client === 'Cobalt Hypermarchés').id);
  await B.page.click('.drawer .tab[data-tab="comments"]');
  await B.page.fill('.composer textarea', 'Julien : rendez-vous acheteur fixé.');
  await B.page.click('.composer button[type="submit"]');
  await until(A.page, (s, i) => s.state.comments.some((c) => c.contractId === i && c.user === 'Julien Moreau'), id, 'commentaire chez A');
  await A.page.evaluate((i) => window.__app.openContract(i, { tab: 'comments' }), id);
  await A.page.waitForSelector('.comment:has-text("rendez-vous acheteur fixé")');
  await A.page.keyboard.press('Escape');
  await B.page.keyboard.press('Escape');
});

await step('Paramètres partagés : un statut renommé par A est mis à jour chez B', async () => {
  const lists = await get(A.page, (s) => JSON.parse(JSON.stringify(s.state.settings.lists)));
  lists.statut.find((o) => o.value === 'Revue juridique').value = 'Revue Legal';
  await get(A.page, async (s, l) => { await s.saveSettings({ lists: l }); await s.replaceListValueInContracts('statut', 'Revue juridique', 'Revue Legal'); }, lists);
  await until(B.page, (s) => s.state.settings.lists.statut.some((o) => o.value === 'Revue Legal') && !s.state.list.some((c) => c.values.statut === 'Revue juridique'), null, 'statut renommé chez B');
});

await step('Journal : les actions des deux utilisateurs sont tracées', async () => {
  const users = await until(A.page, (s) => { const u = new Set(s.state.history.map((h) => h.user)); return u.has('Camille Laurent') && u.has('Julien Moreau') ? [...u] : null; }, null, 'journal');
  assert(users.value.length >= 2, 'deux auteurs');
  const n = await get(B.page, (s) => s.state.history.filter((h) => h.action === 'update' && h.field === 'prochaineAction').length);
  assert(n >= 2, 'modifications de prochaine action tracées');
});

await step('Hors ligne : les modifications sont conservées puis envoyées au retour du réseau', async () => {
  const id = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'Fusion Store').id);
  await A.context.setOffline(true);
  await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  try {
    const t0 = Date.now();
    await get(A.page, (s, i) => s.updateField(i, 'commentaires', 'Saisi hors ligne'), id);
    const local = await until(A.page, (s, i) => s.getContract(i).values.commentaires === 'Saisi hors ligne', id, 'visible localement');
    console.log(`    (affichée localement en ${Date.now() - t0} ms, dont ${local.ms} ms d’attente)`);
    await A.page.waitForSelector('#sync.sync-warn', { timeout: 5000 });
    await B.page.waitForTimeout(1500);
    assert(await get(B.page, (s, i) => s.getContract(i).values.commentaires !== 'Saisi hors ligne', id), 'pas encore chez B');
  } finally {
    await A.context.setOffline(false);
    await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
  }
  const r = await until(B.page, (s, i) => s.getContract(i).values.commentaires === 'Saisi hors ligne', id, 'synchronisé au retour du réseau', 45000);
  console.log(`    (reçue chez B ${r.ms} ms après le retour du réseau)`);
});

await step('Suppression par A pendant que B consulte la fiche', async () => {
  const id = await get(A.page, (s) => s.state.list.find((c) => c.values.client === 'Granit Télécom').id);
  await B.page.evaluate((i) => window.__app.openContract(i), id);
  await B.page.waitForSelector('.drawer .field-row');
  await get(A.page, (s, i) => s.deleteContracts([i]), id);
  await until(B.page, (s, i) => !s.getContract(i), id, 'suppression reçue');
  await B.page.waitForSelector('.toast:has-text("supprimé")', { timeout: 5000 });
  await B.page.waitForFunction(() => !document.querySelector('#drawer-root.open'), null, { timeout: 5000 });
});

await step('Création simultanée : références distinctes', async () => {
  const [ida, idb] = await Promise.all([
    get(A.page, (s) => s.createContract({ client: 'Créé par A' })),
    get(B.page, (s) => s.createContract({ client: 'Créé par B' })),
  ]);
  const refs = await until(A.page, (s, ids) => { const a = s.getContract(ids[0]); const b = s.getContract(ids[1]); return a && b ? [a.values.ref, b.values.ref] : null; }, [ida, idb], 'deux contrats');
  assert(refs.value[0] !== refs.value[1], `références différentes (${refs.value.join(' / ')})`);
});

await step('Compte non autorisé : accès refusé, aucune donnée lue', async () => {
  const C = await openAs('intrus@test.local');
  await C.page.waitForSelector('.denied', { timeout: 15000 });
  assert((await C.page.textContent('.denied h1')).includes('Accès non autorisé'), 'écran de refus');
  await C.context.close();
});

await step('Règles : le journal ne peut pas être modifié', async () => {
  const res = await A.page.evaluate(async () => {
    const fb = await import('/vendor/firebase.js');
    const db = fb.getFirestore();
    const snap = await fb.getDocs(fb.query(fb.collection(db, 'seasons', '2027', 'history'), fb.limit(1)));
    const ref = snap.docs[0].ref;
    try { await fb.updateDoc(ref, { to: 'falsifié' }); return 'modifié'; } catch (e) { return e.code; }
  });
  eq(res, 'permission-denied', 'mise à jour du journal refusée');
});

await step('Déconnexion', async () => {
  await A.page.click('#user-btn');
  await A.page.click('.menu-item:has-text("Se déconnecter")');
  await A.page.waitForSelector('.login-form', { timeout: 10000 });
});

await step('Aucune erreur inattendue dans la console', async () => {
  const unexpected = errors.filter((e) => !/permission-denied|Missing or insufficient permissions|ERR_INTERNET_DISCONNECTED|net::ERR|Could not reach Cloud Firestore|WebChannelConnection|offline/i.test(e));
  eq(unexpected, [], 'erreurs');
});

const failures = summary();
await browser.close();
await server.close();
process.exit(failures ? 1 : 0);
