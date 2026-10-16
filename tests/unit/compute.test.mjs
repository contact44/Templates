import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../../site/assets/js/core/schema.js';
import {
  agenda, alertsOf, breakdown, coerceValue, deriveAll, kpis, matchFilters, progressOf, signatureSeries, sortValue,
} from '../../site/assets/js/core/compute.js';
import { buildDemo } from '../../site/assets/js/core/demo.js';

const s = defaultSettings();
const col = (k) => s.columns.find((c) => c.key === k);
const C = (values, id = 'x') => ({ id, values: { cm: 'cm1', ...values } });

test('alertes : CGV non envoyées après la date limite (L441-3 IV)', () => {
  const a = alertsOf(s, C({ statut: 'À lancer' }), '2026-12-03');
  assert.ok(a.some((x) => x.code === 'cgvLate' && x.level === 'critical'));
  const b = alertsOf(s, C({ statut: 'À lancer' }), '2026-11-20');
  assert.ok(b.some((x) => x.code === 'cgvSoon' && x.level === 'warning'));
  assert.ok(!alertsOf(s, C({ statut: 'CGV envoyées', dateCgv: '2026-11-02' }), '2026-12-03').some((x) => x.code.startsWith('cgv')));
});

test('alertes : date butoir du 1er mars (L441-3 III) et objectif interne', () => {
  assert.ok(alertsOf(s, C({ statut: 'Négociation en cours', dateCgv: '2026-11-01' }), '2027-03-02').some((x) => x.code === 'sigLate'));
  assert.ok(alertsOf(s, C({ statut: 'Négociation en cours', dateCgv: '2026-11-01' }), '2027-02-20').some((x) => x.code === 'targetMissed'));
  assert.ok(alertsOf(s, C({ statut: 'CGV envoyées', dateCgv: '2026-11-01' }), '2027-02-05').some((x) => x.code === 'sigRisk'));
  assert.equal(alertsOf(s, C({ statut: 'Signé', dateCgv: '2026-11-01' }), '2027-03-05').length, 0, 'aucune alerte une fois signé');
});

test('alertes : actions en retard, bloqué, sans responsable', () => {
  const a = alertsOf(s, { id: 'y', values: { statut: 'Bloqué / Escalade', echeance: '2026-10-10', dateCgv: '2026-10-05' } }, '2026-10-16');
  assert.deepEqual(a.map((x) => x.code), ['blocked', 'actionLate', 'noCm']);
  assert.equal(a[0].level, 'critical');
});

test('avancement par statut', () => {
  assert.equal(progressOf(s, C({ statut: 'Revue juridique' })), 55);
  assert.equal(progressOf(s, C({ statut: 'Signé' })), 100);
  assert.equal(progressOf(s, C({ statut: 'Bloqué / Escalade' })), null);
});

test('indicateurs sur les données de démonstration', () => {
  const demo = buildDemo(s, '2026-10-16');
  const settings = { ...s, team: demo.team };
  const d = deriveAll(settings, demo.contracts, '2026-10-16');
  const k = kpis(settings, demo.contracts, d, '2026-10-16');
  assert.equal(k.total, 42);
  assert.equal(k.live + k.cancelled, 42);
  assert.equal(k.signed + k.active + k.todo + k.blocked, k.live);
  assert.equal(k.daysToSignature, 136);
  assert.equal(k.daysToCgv, 46);
  const groups = breakdown(settings, demo.contracts, d, 'cm');
  assert.equal(groups.reduce((a, g) => a + g.total, 0), k.live);
  const series = signatureSeries(settings, demo.contracts, d, '2026-10-16');
  assert.equal(series.points[series.points.length - 1].value, k.signed - series.undated);
  for (const c of demo.contracts) {
    for (const key of ['dateCgv', 'dateRetourCgv', 'dateVersion', 'dateSignature']) if (c.values[key]) assert.ok(c.values[key] < '2026-10-16', `${c.values.client} ${key} dans le passé`);
  }
  const ag = agenda(settings, demo.contracts, d, '2026-10-16');
  assert.ok(ag.overdue.every((x) => x.date < '2026-10-16'));
});

test('conversion des valeurs collées ou importées', () => {
  assert.equal(coerceValue(s, col('priorite'), 'p1'), 'P1 – Critique');
  assert.deepEqual(coerceValue(s, col('division'), 'Mobile (MX), DA; IT & Moniteurs'), ['Mobile (MX)', 'Électroménager (DA)', 'IT & Moniteurs']);
  assert.equal(coerceValue(s, col('ca'), '12 450,5 k€'), 12450.5);
  assert.equal(coerceValue(s, col('dateCgv'), '01/12/2026'), '2026-12-01');
  assert.equal(coerceValue(s, col('cm'), 'Contract Manager 2'), 'cm2');
  const missing = [];
  assert.equal(coerceValue(s, col('canal'), 'Duty free', { addMissing: (k, v) => missing.push([k, v]) }), 'Duty free');
  assert.deepEqual(missing, [['canal', 'Duty free']]);
});

test('filtres : recherche sans accents, champs, raccourcis', () => {
  const c = C({ client: 'Écho Multimédia', statut: 'Bloqué / Escalade', division: ['Mobile (MX)'] });
  const d = { stage: 'blocked', alerts: [] };
  assert.ok(matchFilters(s, c, d, { search: 'echo multi' }));
  assert.ok(!matchFilters(s, c, d, { search: 'alto' }));
  assert.ok(matchFilters(s, c, d, { fields: { division: ['Mobile (MX)'] } }));
  assert.ok(!matchFilters(s, c, d, { fields: { cm: ['cm2'] } }));
  assert.ok(matchFilters(s, c, d, { quick: 'blocked' }));
  assert.ok(matchFilters(s, { id: 'z', values: {} }, d, { fields: { cm: ['__empty__'] } }));
});

test('tri : ordre des listes, références numériques', () => {
  assert.ok(sortValue(s, C({ statut: 'Signé' }), col('statut')) > sortValue(s, C({ statut: 'CGV envoyées' }), col('statut')));
  assert.ok(sortValue(s, C({ ref: 'SC27-010' }), col('ref')) > sortValue(s, C({ ref: 'SC27-9' }), col('ref')));
});
