import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalBackend } from '../../site/assets/js/core/backend-local.js';
import { createStore } from '../../site/assets/js/core/store.js';
import { defaultSettings, listOptions } from '../../site/assets/js/core/schema.js';
import { setToday } from '../../site/assets/js/core/utils.js';

setToday('2026-10-16');
const tick = () => new Promise((r) => setTimeout(r, 5));
const S = defaultSettings();
const GEN = listOptions(S, 'statut').map((o) => o.value);
const DIV = listOptions(S, 'reportDiv').map((o) => o.value);

async function fresh(patch = null) {
  const backend = createLocalBackend({ seasonId: `t${Math.random()}` });
  await backend.init();
  const store = createStore(backend);
  store.setUser(backend.user);
  await backend.ensureSeason(defaultSettings());
  await store.start();
  if (patch) await store.saveSettings(patch, 'test');
  await tick();
  return store;
}

test('création : référence numérotée comme dans le classeur, compte actif au premier statut', async () => {
  const store = await fresh();
  const a = await store.createContract({ client: 'ALTO', division: 'AV' });
  const b = await store.createContract({ client: 'BRIO', division: 'DA' });
  await tick();
  assert.equal(store.getContract(a).values.ref, '1');
  assert.equal(store.getContract(b).values.ref, '2');
  assert.equal(store.getContract(a).values.statutCompte, 'Actif');
  assert.equal(store.getContract(a).values.statut, GEN[0]);
  assert.equal(store.getContract(a).values.statutModifieLe, '2026-10-16');
});

test('macro HorodaterStatut : REPORT GEN ou REPORT PAR DIV date la colonne « Statut modifié le »', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'ALTO', division: 'AV', statutModifieLe: '2026-09-01' });
  await tick();
  await store.updateField(id, 'kam', 'Paul');
  await tick();
  assert.equal(store.getContract(id).values.statutModifieLe, '2026-09-01', 'autre colonne : pas d’horodatage');
  await store.updateField(id, 'reportDiv', DIV[3]);
  await tick();
  assert.equal(store.getContract(id).values.statutModifieLe, '2026-10-16');
  await store.updateFields(id, { statut: null, reportDiv: null });
  await tick();
  assert.equal(store.getContract(id).values.statutModifieLe ?? null, null, 'effacée si les deux statuts sont vides');
  assert.ok(store.state.history.some((h) => h.field === 'statutModifieLe' && h.auto));
});

test('horodatage désactivable dans les automatisations', async () => {
  const store = await fresh({ automations: { ...S.automations, stampStatusChange: false } });
  const id = await store.createContract({ client: 'ALTO', division: 'AV', statutModifieLe: '2026-09-01' });
  await tick();
  await store.updateField(id, 'reportDiv', DIV[3]);
  await tick();
  assert.equal(store.getContract(id).values.statutModifieLe, '2026-09-01');
});

test('annuler / rétablir, y compris une suppression', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'ALTO' });
  await tick();
  await store.updateField(id, 'kam', 'Marc');
  await tick();
  await store.undo();
  await tick();
  assert.equal(store.getContract(id).values.kam ?? null, null);
  await store.redo();
  await tick();
  assert.equal(store.getContract(id).values.kam, 'Marc');
  await store.deleteContracts([id]);
  await tick();
  assert.equal(store.getContract(id), null);
  await store.undo();
  await tick();
  assert.equal(store.getContract(id).values.client, 'ALTO');
});

test('macro « Trier les comptes » : fermés en bas (plus récents d’abord) et renumérotation', async () => {
  const store = await fresh();
  await store.importContracts([
    { client: 'ZETA', division: 'AV', statutCompte: 'Actif' },
    { client: 'BRIO', division: 'TE', statutCompte: 'Fermé', anneeFermeture: 2025 },
    { client: 'ALTO', division: 'DA', statutCompte: 'Actif' },
    { client: 'CORA', division: 'AV', statutCompte: 'Fermé', anneeFermeture: 2026 },
    { client: 'ALTO', division: 'AV', statutCompte: "À l'étude" },
  ]);
  await tick();
  const n = await store.sortAccounts();
  await tick();
  assert.ok(n > 0);
  const order = store.state.list.slice().sort((a, b) => Number(a.values.ref) - Number(b.values.ref)).map((c) => `${c.values.client} ${c.values.division}`);
  assert.deepEqual(order, ['ALTO AV', 'ALTO DA', 'ZETA AV', 'CORA AV', 'BRIO TE']);
  assert.ok(store.state.history.some((h) => h.action === 'sort'));
  assert.equal(await store.sortAccounts(), 0, 'déjà trié : rien à faire');
});

test('figer la semaine : chiffres du moment enregistrés pour le dernier vendredi', async () => {
  const store = await fresh();
  await store.importContracts([
    { client: 'A', division: 'AV', statutCompte: 'Actif', statut: GEN[0] },
    { client: 'B', division: 'AV', statutCompte: 'Actif', statut: GEN[8] },
  ]);
  await tick();
  assert.equal(await store.freezeWeek(), null, 'avant le premier vendredi du suivi');
  store.state.today = '2026-12-09'; // un mercredi : la ligne à figer est celle du vendredi précédent
  const r = await store.freezeWeek();
  await tick();
  assert.equal(r.date, '2026-12-04');
  assert.deepEqual([r.attendus, r.signes], [2, 1]);
  assert.equal(store.state.settings.hebdoWeeks['2026-12-04'].signes, 1);
});

test('import « mise à jour » : reconnaissance par référence ou par client + division', async () => {
  const store = await fresh();
  await store.importContracts([{ client: 'ALTO', division: 'AV', kam: 'Ancien' }, { client: 'ALTO', division: 'DA', kam: 'Ancien' }]);
  await tick();
  const res = await store.importContracts([{ client: 'alto', division: 'DA', kam: 'Nouveau' }, { client: 'BRIO', division: 'AV' }], { mode: 'update' });
  await tick();
  assert.deepEqual(res, { created: 1, updated: 1 });
  const byDiv = Object.fromEntries(store.state.list.filter((c) => c.values.client === 'ALTO').map((c) => [c.values.division, c.values.kam]));
  assert.deepEqual(byDiv, { AV: 'Ancien', DA: 'Nouveau' });
});

test('import : les références du fichier sont conservées et le compteur suit', async () => {
  const store = await fresh();
  await store.importContracts([{ ref: '12', client: 'A' }, { ref: '40', client: 'B' }]);
  await tick();
  const id = await store.createContract({ client: 'C' });
  await tick();
  assert.equal(store.getContract(id).values.ref, '41');
});

test('création par collage annulable sans perdre l’historique d’annulation', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'Avant' });
  await tick();
  await store.updateField(id, 'kam', 'X');
  await tick();
  await store.importContracts([{ client: 'Collé 1' }, { client: 'Collé 2' }], { mode: 'append', source: 'Collage', undoable: true });
  await tick();
  assert.equal(store.state.list.length, 3);
  await store.undo();
  await tick();
  assert.equal(store.state.list.length, 1);
  await store.undo();
  await tick();
  assert.equal(store.getContract(id).values.kam ?? null, null);
});

test('renommer une valeur de liste met à jour les lignes', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'ALTO', juriste: 'Juriste 1' });
  await tick();
  await store.renameListValue('juriste', 'Juriste 1', 'Sophie Martin');
  await tick();
  assert.equal(store.getContract(id).values.juriste, 'Sophie Martin');
});

test('saison suivante : 2027 passe en historique, comptes fermés retirés, années décalées', async () => {
  const store = await fresh();
  await store.importContracts([
    { client: 'ALTO', division: 'AV', statutCompte: 'Actif', statut: GEN[9], reportDiv: DIV[14], signatureClient: '2027-01-10', signatureSef: '2027-01-12', attribution2026: 'CM', attribution2027: 'JURISTE', suiviCm: 'Signé' },
    { client: 'BRIO', division: 'TE', statutCompte: 'Fermé', anneeFermeture: 2027 },
  ]);
  await tick();
  const b = store.nextSeasonBackup();
  assert.equal(b.seasonId, '2028');
  assert.equal(b.settings.season.year, 2028);
  assert.equal(b.contracts.length, 1);
  const v = b.contracts[0].values;
  assert.equal(v.n1ReportGen, GEN[9]);
  assert.equal(v.n1SignatureSef, '2027-01-12');
  assert.equal(v.n1SuiviCm, 'Signé');
  assert.equal(v.attribution2026, 'JURISTE');
  assert.equal(v.n1Attribution, 'CM');
  assert.equal(v.signatureSef, null);
  assert.equal(v.statut, '1.Attente CC 2028');
  assert.equal(b.settings.milestones.find((m) => m.role === 'signature').date, '2028-03-01');
  assert.ok(b.settings.columns.some((c) => c.label === 'Attribution CM/Juriste 2028'));
});

test('sauvegarde complète puis restauration', async () => {
  const store = await fresh();
  await store.importContracts([{ client: 'A', division: 'AV' }, { client: 'B', division: 'DA' }]);
  await tick();
  const backup = await store.exportBackup();
  const other = await fresh();
  await other.restoreBackup(JSON.parse(JSON.stringify(backup)));
  await tick();
  assert.equal(other.state.list.length, 2);
  await assert.rejects(() => other.restoreBackup({ format: 'autre' }));
});

test('journal : pagination sans perte pour des entrées de même milliseconde', async () => {
  const store = await fresh();
  for (let i = 0; i < 12; i++) await store.createContract({ client: `C${i}` });
  await tick();
  await store.bulkUpdate(store.state.list.map((c) => c.id), { kam: 'Même instant' });
  await tick();
  const page1 = await store.state.backend.loadHistory({ max: 5 });
  const page2 = await store.olderHistory(page1[page1.length - 1], 1000);
  const ids = new Set([...page1, ...page2].map((h) => h.id));
  assert.equal(ids.size, store.state.history.length);
});

test('annuler un changement de statut rétablit aussi l’horodatage', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'ALTO', division: 'AV', statutModifieLe: '2026-09-01' });
  await tick();
  await store.updateField(id, 'reportDiv', DIV[4]);
  await tick();
  assert.equal(store.getContract(id).values.statutModifieLe, '2026-10-16');
  assert.equal(store.getContract(id).values.statut, '4.Revue en cours', 'REPORT GEN déduit de l’étape');
  await store.undo();
  await tick();
  assert.equal(store.getContract(id).values.reportDiv, DIV[0]);
  assert.equal(store.getContract(id).values.statut, GEN[0]);
  assert.equal(store.getContract(id).values.statutModifieLe, '2026-09-01');
  await store.updateField(id, 'ref', '999');
  await tick();
  assert.equal(store.getContract(id).values.ref, '1', 'la référence reste en lecture seule');
});

test('REPORT GEN suit l’étape REPORT PAR DIV et ne se saisit pas directement', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'ALTO', division: 'AV' });
  await tick();
  for (const [div, gen] of [[DIV[2], '4.Revue en cours'], [DIV[3], '3.Attente accord client sur contrat SEF'], [DIV[11], '8.Signature en cours'], [DIV[14], '10.Clôturé SELMS']]) {
    await store.updateField(id, 'reportDiv', div);
    await tick();
    assert.equal(store.getContract(id).values.statut, gen, div);
  }
  await store.updateField(id, 'statut', GEN[0]);
  await tick();
  assert.equal(store.getContract(id).values.statut, '10.Clôturé SELMS', 'saisie directe de REPORT GEN ignorée');
  await store.importContracts([{ client: 'BRIO', division: 'TE', reportDiv: DIV[9], statut: GEN[0] }]);
  await tick();
  assert.equal(store.state.list.find((c) => c.values.client === 'BRIO').values.statut, '7.Attente Mise en signature', 'import : l’étape fait foi');
});
