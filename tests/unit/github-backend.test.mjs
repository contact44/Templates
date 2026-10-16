// Stockage GitHub contre un serveur GitHub simulé : initialisation d'un dépôt vide, propagation,
// modifications simultanées fusionnées champ par champ, suppression concurrente, journal.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockGitHub } from '../e2e/mock-github.mjs';
import { createGithubBackend, parseJournal } from '../../site/assets/js/core/backend-github.js';
import { defaultSettings } from '../../site/assets/js/core/schema.js';

const mock = await startMockGitHub({
  latency: 5,
  tokens: {
    'tok-a': { login: 'claire', name: 'Claire', repos: { 'equipe/donnees': 'write' } },
    'tok-b': { login: 'julien', name: 'Julien', repos: { 'equipe/donnees': 'write' } },
    'tok-r': { login: 'lecteur', name: 'Lecteur', repos: { 'equipe/donnees': 'read' } },
  },
  repos: { 'equipe/donnees': { private: true } },
});
after(() => mock.close());

const config = { seasonId: '2027', github: { owner: 'equipe', repo: 'donnees', apiBase: mock.url, pollMs: 60 } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, timeout = 5000) {
  const t0 = Date.now();
  for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > timeout) throw new Error(`Délai dépassé : ${label}`); await wait(20); }
}

function client(token) {
  const b = createGithubBackend(config);
  const st = { contracts: [], settings: null, history: [], errors: [], sync: '' };
  const h = {
    settings: (s) => { st.settings = s; }, contracts: (l) => { st.contracts = l; }, comments: () => {}, history: (l) => { st.history = l; },
    presence: () => {}, sync: (s) => { st.sync = s.status; }, error: (e) => st.errors.push(e), denied: () => st.errors.push({ code: 'denied' }),
  };
  return { b, st, h, token, get: (id) => st.contracts.find((c) => c.id === id) };
}

const A = client('tok-a');
const B = client('tok-b');
const actorA = { uid: 'claire', name: 'Claire' };
const actorB = { uid: 'julien', name: 'Julien' };
const entry = (who, contractId, field, to) => ({ id: `${who}-${Math.random().toString(36).slice(2)}`, ts: Date.now(), uid: who, user: who, action: 'update', contractId, field, fieldLabel: field, from: '', to });

test('dépôt vide : initialisation de la saison puis lecture par un second utilisateur', async () => {
  await A.b.signIn('tok-a');
  const created = await A.b.ensureSeason(defaultSettings());
  assert.ok(created, 'saison créée');
  await A.b.start(A.h);
  await B.b.signIn('tok-b');
  assert.equal(await B.b.ensureSeason(defaultSettings()), null, 'pas de seconde initialisation');
  await B.b.start(B.h);
  assert.equal(B.st.settings.season.year, 2027);
  const files = await (await fetch(`${mock.url}/__admin/files?repo=equipe/donnees`)).json();
  assert.ok(files['suivi-cm/2027/parametres.json'], 'paramètres écrits');
});

test('création par A visible chez B', async () => {
  await A.b.createContracts([{ id: 'c1', values: { ref: '1', client: 'ACAD', division: 'AV' } }], [{ id: 'h1', ts: Date.now(), uid: 'claire', user: 'Claire', action: 'create', contractId: 'c1' }], actorA);
  assert.ok(A.get('c1'), 'affiché tout de suite chez A');
  await until(() => B.get('c1'), 'propagation');
  assert.equal(B.get('c1').values.client, 'ACAD');
});

test('modifications simultanées de champs différents : les deux sont conservées', async () => {
  await Promise.all([
    A.b.updateContracts([{ id: 'c1', patch: { kam: 'KAM A' } }], [entry('claire', 'c1', 'kam', 'KAM A')], actorA),
    B.b.updateContracts([{ id: 'c1', patch: { selms: 'REQ-42' } }], [entry('julien', 'c1', 'selms', 'REQ-42')], actorB),
  ]);
  await until(() => A.get('c1')?.values.selms === 'REQ-42' && B.get('c1')?.values.kam === 'KAM A' && !A.b.pendingCount() && !B.b.pendingCount(), 'fusion');
  const files = await (await fetch(`${mock.url}/__admin/files?repo=equipe/donnees`)).json();
  const saved = JSON.parse(files['suivi-cm/2027/contrats/c1.json']);
  assert.equal(saved.values.kam, 'KAM A');
  assert.equal(saved.values.selms, 'REQ-42');
});

test('même champ modifié par les deux : une seule valeur partout', async () => {
  await Promise.all([
    A.b.updateContracts([{ id: 'c1', patch: { suiviCm: 'version A' } }], [], actorA),
    B.b.updateContracts([{ id: 'c1', patch: { suiviCm: 'version B' } }], [], actorB),
  ]);
  await until(() => !A.b.pendingCount() && !B.b.pendingCount(), 'enregistrement');
  await until(() => A.get('c1')?.values.suiviCm === B.get('c1')?.values.suiviCm, 'convergence');
  assert.ok(['version A', 'version B'].includes(A.get('c1').values.suiviCm));
});

test('modifications groupées en rafale : un commit par lot, aucune perte', async () => {
  for (let i = 0; i < 12; i++) await A.b.createContracts([{ id: `r${i}`, values: { ref: String(10 + i), client: `Client ${i}` } }], [], actorA);
  await until(() => B.st.contracts.filter((c) => c.id.startsWith('r')).length === 12, 'rafale');
});

test('suppression par A pendant une modification de B : modification abandonnée et signalée', async () => {
  await A.b.deleteContracts(['r0'], []);
  await until(() => !A.b.pendingCount(), 'suppression enregistrée');
  await B.b.updateContracts([{ id: 'r0', patch: { kam: 'trop tard' } }], [], actorB);
  await until(() => B.st.errors.some((e) => e.code === 'deleted-by-peer'), 'signalement');
  await until(() => !B.get('r0'), 'disparu chez B');
});

test('journal : entrées des deux utilisateurs lues dans les commits', async () => {
  await until(() => B.st.history.some((h) => h.user === 'claire' || h.user === 'Claire') && A.st.history.some((h) => h.uid === 'julien'), 'journal partagé');
  const full = await A.b.loadHistory({ max: 1000 });
  assert.ok(full.some((h) => h.field === 'selms'));
  const one = await A.b.loadHistory({ contractId: 'c1' });
  assert.ok(one.length >= 2 && one.every((h) => h.contractId === 'c1' || h.action === 'external'));
  assert.equal(parseJournal('titre\n\njournal: {"id":"x","ts":1}').length, 1);
});

test('clé en lecture seule : écriture refusée, modification conservée en attente', async () => {
  const R = client('tok-r');
  await R.b.signIn('tok-r');
  await R.b.start(R.h);
  await R.b.updateContracts([{ id: 'c1', patch: { kam: 'lecteur' } }], [], { uid: 'lecteur', name: 'Lecteur' });
  await until(() => R.st.errors.some((e) => e.code === 'permission-denied'), 'refus');
  assert.equal(R.b.pendingCount(), 1);
  await R.b.signOut();
});

test('arrêt des clients', async () => {
  await A.b.signOut(); await B.b.signOut();
  assert.ok(mock.stats.conflicts >= 1, `des conflits réels ont été provoqués et résolus (${mock.stats.conflicts})`);
});
