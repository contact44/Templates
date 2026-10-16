import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalBackend } from '../../site/assets/js/core/backend-local.js';
import { createStore } from '../../site/assets/js/core/store.js';
import { defaultSettings } from '../../site/assets/js/core/schema.js';
import { setToday } from '../../site/assets/js/core/utils.js';

setToday('2026-10-16');
const tick = () => new Promise((r) => setTimeout(r, 5));

async function fresh() {
  const backend = createLocalBackend({ seasonId: `t${Math.random()}` });
  await backend.init();
  const store = createStore(backend);
  store.setUser(backend.user);
  await backend.ensureSeason(defaultSettings());
  await store.start();
  await tick();
  return store;
}

test('création : référence séquentielle et statut initial', async () => {
  const store = await fresh();
  const a = await store.createContract({ client: 'Alto' });
  const b = await store.createContract({ client: 'Brio' });
  await tick();
  assert.equal(store.getContract(a).values.ref, 'SC27-001');
  assert.equal(store.getContract(b).values.ref, 'SC27-002');
  assert.equal(store.getContract(a).values.statut, 'À lancer');
});

test('automatisations : statut → date et date → statut', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'Alto' });
  await tick();
  await store.updateField(id, 'statut', 'CGV envoyées');
  await tick();
  assert.equal(store.getContract(id).values.dateCgv, '2026-10-16');
  await store.updateField(id, 'dateSignature', '2026-10-15');
  await tick();
  assert.equal(store.getContract(id).values.statut, 'Signé');
  const auto = store.state.history.filter((h) => h.auto);
  assert.equal(auto.length, 2);
});

test('annuler / rétablir', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'Alto' });
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
  assert.equal(store.getContract(id).values.client, 'Alto');
});

test('renommer une valeur de liste met à jour les contrats', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'Alto', division: ['Mobile (MX)', 'IT & Moniteurs'] });
  await tick();
  await store.renameListValue('division', 'Mobile (MX)', 'Mobile');
  await tick();
  assert.deepEqual(store.getContract(id).values.division, ['Mobile', 'IT & Moniteurs']);
});

test('import en mode mise à jour', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'Alto Distribution', kam: 'Ancien' });
  await tick();
  const res = await store.importContracts([{ client: 'alto distribution', kam: 'Nouveau' }, { client: 'Brio' }], { mode: 'update' });
  await tick();
  assert.deepEqual(res, { created: 1, updated: 1 });
  assert.equal(store.getContract(id).values.kam, 'Nouveau');
  assert.equal(store.state.list.length, 2);
});

test('permutation de deux valeurs de liste en une passe (A ↔ B)', async () => {
  const store = await fresh();
  const a = await store.createContract({ client: 'A', priorite: 'P1 – Critique' });
  const b = await store.createContract({ client: 'B', priorite: 'P2 – Haute' });
  await tick();
  await store.remapListValues('priorite', { 'P1 – Critique': 'P2 – Haute', 'P2 – Haute': 'P1 – Critique' });
  await tick();
  assert.equal(store.getContract(a).values.priorite, 'P2 – Haute');
  assert.equal(store.getContract(b).values.priorite, 'P1 – Critique');
});

test('un contrat créé est disponible immédiatement (fiche ouvrable)', async () => {
  const store = await fresh();
  const id = await store.createContract({ client: 'Immédiat' });
  assert.equal(store.getContract(id)?.values.client, 'Immédiat');
});

test('création par collage : annulable sans perdre l’historique d’annulation', async () => {
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
  assert.equal(store.state.list.length, 1, 'les lignes collées sont retirées');
  await store.undo();
  await tick();
  assert.equal(store.getContract(id).values.kam ?? null, null, 'la modification précédente reste annulable');
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
