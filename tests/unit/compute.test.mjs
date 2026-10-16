import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, listOptions } from '../../site/assets/js/core/schema.js';
import {
  accountKey, addMonths, alertsOf, cellTone, coerceValue, deriveAll, divisionGroup, fridays, genOf, groupAccounts, kpis, matchFilters, n1SignedPctAt,
  parsePercent, progressOf, reportByGroup, rowCalc, stageOf, statusMatrix, statusRowsForTab, stepIndex, stepInfo, weeklyRows, weekToFreeze, workload,
} from '../../site/assets/js/core/compute.js';
import { buildDemo } from '../../site/assets/js/core/demo.js';

const s = defaultSettings();
const col = (k) => s.columns.find((c) => c.key === k);
const GEN = listOptions(s, 'statut').map((o) => o.value);
const DIV = listOptions(s, 'reportDiv').map((o) => o.value);
const ACTIF = 'Actif';
const FERME = 'Fermé';
const C = (values, id = 'x') => ({ id, values: { client: 'ALTO', division: 'AV', statutCompte: ACTIF, cm: 'cm1', ...values } });
const TODAY = '2026-10-16';

test('EDATE : même jour un an plus tard, fin de mois respectée', () => {
  assert.equal(addMonths('2026-02-15', 12), '2027-02-15');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
});

test('Durées (auto) : revue, approval, signature et totale comme dans le classeur', () => {
  const r = rowCalc(s, C({
    receptionCc: '2026-12-01', revueAttribuee: '2026-12-02', revueTerminee: '2026-12-11', approvalLancee: '2026-12-12', approvalTerminee: '2026-12-20',
    miseEnSignature: '2027-01-05', signatureClient: '2027-01-10', signatureSef: '2027-01-12',
  }), '2027-02-01');
  assert.equal(r.dureeRevue, 10);
  assert.equal(r.dureeApproval, 8);
  assert.equal(r.dureeSignature, 7, 'jusqu’à la dernière des deux signatures');
  assert.equal(r.dureeTotale, 42);
  // Sans les deux signatures, pas de durée de signature ni de durée totale.
  const p = rowCalc(s, C({ receptionCc: '2026-12-01', miseEnSignature: '2027-01-05', signatureClient: '2027-01-10' }), '2027-02-01');
  assert.equal(p.dureeSignature, null);
  assert.equal(p.dureeTotale, null);
});

test('Jours au stade actuel : depuis le dernier statut ou jalon, seuils à surveiller / bloqué', () => {
  const a = rowCalc(s, C({ statut: GEN[3], statutModifieLe: '2026-10-01', receptionCc: '2026-10-04' }), TODAY);
  assert.equal(a.joursStade, 12);
  assert.equal(a.stadeLevel, 'vigilance');
  assert.equal(rowCalc(s, C({ statut: GEN[3], statutModifieLe: '2026-09-20' }), TODAY).stadeLevel, 'bloque');
  assert.equal(rowCalc(s, C({ statut: GEN[3], statutModifieLe: '2026-10-10' }), TODAY).stadeLevel, '');
  assert.equal(rowCalc(s, C({ statut: GEN[8], statutModifieLe: '2026-09-01' }), TODAY).joursStade, null, 'signé : pas de compteur');
  assert.equal(rowCalc(s, C({ statutCompte: "À l'étude", statutModifieLe: '2026-09-01' }), TODAY).joursStade, null, 'actifs seulement');
});

test('Signature N-1 + 1 an, écart et retard par rapport à la saison précédente', () => {
  const late = rowCalc(s, C({ statut: GEN[3], n1SignatureClient: '2025-10-01', n1SignatureSef: '2025-10-03' }), TODAY);
  assert.equal(late.sigN1Plus1, '2026-10-03');
  assert.equal(late.ecartN1, 13);
  assert.equal(late.retardN1, true);
  const ok = rowCalc(s, C({ statut: GEN[3], n1SignatureClient: '2026-01-10', n1SignatureSef: '2026-01-12' }), TODAY);
  assert.equal(ok.ecartN1 < 0, true);
  assert.equal(ok.retardN1, false);
  const signed = rowCalc(s, C({ statut: GEN[8], signatureClient: '2026-10-08', signatureSef: '2026-10-10', n1SignatureClient: '2025-10-01', n1SignatureSef: '2025-10-03' }), TODAY);
  assert.equal(signed.ecartN1, 7, 'écart figé à la date de signature');
  assert.equal(signed.retardN1, false);
});

test('Contrôle des jalons : ordre incohérent (cellules en rouge) puis date future', () => {
  const bad = rowCalc(s, C({ receptionCc: '2026-10-05', revueAttribuee: '2026-10-06', revueTerminee: '2026-10-02' }), TODAY);
  assert.equal(bad.controle, 'Ordre incohérent');
  assert.deepEqual(bad.badJalons, ['revueTerminee']);
  const fut = rowCalc(s, C({ receptionCc: '2026-10-05', revueAttribuee: '2026-10-20' }), TODAY);
  assert.equal(fut.controle, 'Date future');
  assert.deepEqual(fut.futureJalons, ['revueAttribuee']);
  // La signature client peut précéder la signature SEF (ou l'inverse) sans erreur.
  const sig = rowCalc(s, C({ miseEnSignature: '2026-10-01', signatureClient: '2026-10-08', signatureSef: '2026-10-05' }), TODAY);
  assert.equal(sig.controle, '');
});

test('alertes triées par gravité ; aucune alerte pour un compte fermé', () => {
  const a = alertsOf(s, C({ statut: GEN[3], statutModifieLe: '2026-09-01', receptionCc: '2026-09-02', revueTerminee: '2026-08-01' }), rowCalc(s, C({ statut: GEN[3], statutModifieLe: '2026-09-01', receptionCc: '2026-09-02', revueTerminee: '2026-08-01' }), TODAY));
  assert.ok(['ordre', 'bloque'].includes(a[0].code));
  assert.ok(a.some((x) => x.code === 'bloque'));
  assert.ok(a.some((x) => x.code === 'attribution'));
  assert.equal(alertsOf(s, C({ statutCompte: FERME, statutModifieLe: '2026-01-01' })).length, 0);
});

test('étape du dossier : REPORT PAR DIV fait foi, REPORT GEN en est déduit', () => {
  assert.equal(stepIndex(s, C({ reportDiv: DIV[4] })), 4);
  assert.equal(genOf(s, C({ reportDiv: DIV[4], statut: GEN[0] })), '4.Revue en cours');
  assert.equal(stageOf(s, C({ reportDiv: DIV[11] })), 'signature');
  assert.equal(stepIndex(s, C({ statut: GEN[3] })), 2, 'sans étape DIV : première étape du REPORT GEN saisi');
  assert.equal(stepIndex(s, C({})), -1);
  const info = stepInfo(s, C({ reportDiv: DIV[8] }));
  assert.deepEqual([info.index, info.count, info.name, info.stage], [8, 15, 'Approval en cours', 'active']);
});

test('avancement : rang de l’étape DIV, 100 % une fois signé', () => {
  assert.equal(progressOf(s, C({ reportDiv: DIV[0] })), 0);
  assert.equal(progressOf(s, C({ reportDiv: DIV[13] })), 100);
  assert.equal(progressOf(s, C({ reportDiv: DIV[14] })), 100);
  assert.equal(progressOf(s, C({ reportDiv: DIV[6] })), 46);
});

test('comptes clients : divisions regroupées, phases, équipe, compte fermé', () => {
  const list = [
    C({ client: 'Alto', division: 'TE', reportDiv: DIV[13], cm: 'cm1', juriste: 'Juriste 1' }, 'a'), C({ client: 'ALTO ', division: 'AV', reportDiv: DIV[4], cm: 'cm2' }, 'b'),
    C({ client: 'Brio', division: 'DA', statutCompte: FERME }, 'c'),
  ];
  const acc = groupAccounts(s, list, deriveAll(s, list, TODAY));
  assert.equal(acc.length, 2);
  const alto = acc.find((x) => x.key === accountKey('alto'));
  assert.deepEqual(alto.rows.map((c) => c.values.division), ['AV', 'TE'], 'ordre des divisions de la liste');
  assert.deepEqual([alto.total, alto.signed, alto.stages.active, alto.stages.done], [2, 1, 1, 1]);
  assert.deepEqual(alto.cms, ['cm2', 'cm1']);
  assert.equal(acc.find((x) => x.key === 'brio').role, 'ferme');
});

test('mise en forme conditionnelle des cellules', () => {
  const t = (values, key) => cellTone(s, C(values), col(key), rowCalc(s, C(values), TODAY));
  assert.equal(t({ gag2027: 0.2 }, 'gag2027'), 'tone-danger');
  assert.equal(t({ gag2027: 0.1 }, 'gag2027'), '');
  assert.equal(t({}, 'attribution2027'), 'tone-yellow');
  assert.equal(t({ attribution2027: 'JURISTE' }, 'attribution2027'), 'tone-purple');
  assert.equal(t({ signaturePafSef: 'NON' }, 'signaturePafSef'), 'tone-danger-text');
  assert.equal(t({ statut: GEN[8] }, 'statut'), 'tone-success');
  assert.equal(t({ statut: GEN[6] }, 'statut'), 'tone-info');
  assert.equal(t({ statutCompte: "À l'étude" }, 'client'), 'tone-yellow');
  assert.equal(t({ statutCompte: 'Nouveau' }, 'division'), 'tone-green');
  assert.equal(t({ n1ReportGen: GEN[7] }, 'n1ReportGen'), 'tone-danger-text', 'N-1 non clôturé');
  assert.equal(t({ n1ReportGen: GEN[9] }, 'n1ReportGen'), '');
  assert.equal(t({ receptionCc: '2026-10-05', revueTerminee: '2026-10-02' }, 'revueTerminee'), 'tone-danger');
});

test('regroupement des divisions MO et matrice statut × division', () => {
  assert.equal(divisionGroup(s, 'MO (LED)'), 'MO');
  assert.equal(divisionGroup(s, 'AV'), 'AV');
  const list = [C({ division: 'AV', statut: GEN[0] }, 'a'), C({ division: 'AV', reportDiv: DIV[0] }, 'b'), C({ division: 'TE', statut: GEN[8] }, 'c'), C({ division: 'XX', statut: GEN[1] }, 'd')];
  const m = statusMatrix(s, list, 'statut');
  assert.equal(m.rows.find((r) => r.division === 'AV').counts[GEN[0]], 2);
  assert.equal(m.rows.find((r) => r.division === 'XX').total, 1, 'division inconnue conservée');
});

test('reporting général : totaux SEF / CE / IM, signés et pourcentages', () => {
  const list = [
    C({ division: 'AV', statut: GEN[0] }, 'a'), C({ division: 'MO (LCD)', statut: GEN[8] }, 'b'), C({ division: 'MO (LED)', statut: GEN[3] }, 'c'),
    C({ division: 'TE', statut: GEN[9] }, 'd'), C({ division: 'TE', statut: GEN[6] }, 'e'), C({ division: 'TE' }, 'f'),
  ];
  const rep = reportByGroup(s, list, deriveAll(s, list, TODAY));
  assert.equal(rep.all.total, 5, 'les lignes sans REPORT GEN ne comptent pas');
  assert.equal(rep.all.signed, 2);
  assert.equal(rep.families.find((f) => f.key === 'CE').total, 3);
  assert.equal(rep.groups.find((g) => g.key === 'MO').total, 2);
  assert.equal(rep.groups.find((g) => g.key === 'TE').pct, 0.5);
  assert.deepEqual(rep.all.stages, { todo: 1, active: 1, signature: 1, done: 2 });
  // Tableau « statut » : signature et signés cumulés sur une ligne chacun (8 lignes pour 10 statuts).
  const rows = statusRowsForTab(s);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[rows.length - 1].values, [GEN[8], GEN[9]]);
});

test('charge équipe : comptes actifs par CM et par juriste', () => {
  const team = [{ id: 'cm1', name: 'Camille' }, { id: 'cm2', name: 'Julien' }];
  const st = { ...s, team };
  const list = [
    C({ cm: 'cm1', juriste: 'Juriste 1', statut: GEN[0] }, 'a'), C({ cm: 'cm1', statut: GEN[8] }, 'b'),
    C({ cm: 'cm2', statut: GEN[3], statutModifieLe: '2026-09-01' }, 'c'), C({ cm: 'cm2', statutCompte: FERME, statut: GEN[0] }, 'd'), C({ cm: '', statut: GEN[0] }, 'e'),
  ];
  const w = workload(st, list, deriveAll(st, list, TODAY), 'cm');
  assert.deepEqual(w.rows.map((r) => [r.key, r.actifs]), [['cm1', 2], ['cm2', 1], ['__none__', 1]]);
  assert.equal(w.rows[1].bloques, 1);
  assert.equal(w.total.actifs, 4);
  assert.equal(w.rows[0].pct, 0.5);
  const j = workload(st, list, deriveAll(st, list, TODAY), 'juriste');
  assert.equal(j.rows.find((r) => r.key === 'Juriste 1').actifs, 1);
});

test('suivi hebdo : vendredis, semaine à figer, % N-1 à la même date', () => {
  const f = fridays('2026-12-01', '2026-12-31');
  assert.deepEqual(f, ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  assert.equal(weekToFreeze(s, '2026-12-10'), '2026-12-04');
  assert.equal(weekToFreeze(s, '2026-11-30'), null);
  const list = [C({ n1ReportGen: GEN[9], n1SignatureClient: '2025-12-01', n1SignatureSef: '2025-12-02' }, 'a'), C({ n1ReportGen: GEN[9], n1SignatureClient: '2026-01-10', n1SignatureSef: '2026-01-12' }, 'b')];
  assert.equal(n1SignedPctAt(list, '2026-12-04'), 0.5);
  const rows = weeklyRows({ ...s, hebdoWeeks: { '2026-12-04': { attendus: 10, signes: 2, figeLe: 1, par: 'Camille' } } }, list);
  assert.equal(rows[0].pct, 0.2);
  assert.equal(rows[1].pct, null);
});

test('filtres et raccourcis', () => {
  const c = C({ statut: GEN[3], statutModifieLe: '2026-09-01', division: 'MO (LFD)' });
  const d = rowCalc(s, c, TODAY);
  assert.ok(matchFilters(s, c, d, { quick: 'stade' }));
  assert.ok(matchFilters(s, c, d, { fields: { divisionGroup: ['MO'] } }));
  assert.ok(!matchFilters(s, c, d, { quick: 'signes' }));
  assert.ok(matchFilters(s, c, d, { search: 'alto' }));
  assert.ok(matchFilters(s, c, d, { fields: { juriste: ['__empty__'] } }));
  assert.ok(matchFilters(s, c, d, { quick: 'mine' }, { meId: 'cm1' }));
});

test('saisie : pourcentages, cases à cocher, listes et dates', () => {
  assert.equal(parsePercent('28,6 %'), 0.286);
  assert.equal(parsePercent(0.15), 0.15);
  assert.equal(parsePercent('15'), 0.15);
  assert.equal(coerceValue(s, col('multiDivisions'), 'X'), true);
  assert.equal(coerceValue(s, col('multiDivisions'), 'non'), false);
  assert.equal(coerceValue(s, col('statutCompte'), 'actif'), ACTIF);
  assert.equal(coerceValue(s, col('receptionCc'), '05/12/2026'), '2026-12-05');
});

test('démonstration : données cohérentes et indicateurs', () => {
  const demo = buildDemo(s, TODAY);
  const list = demo.contracts;
  const st = { ...s, team: demo.team, lists: { ...s.lists, ...demo.settingsPatch.lists } };
  const derived = deriveAll(st, list, TODAY);
  const k = kpis(st, list, derived, TODAY);
  assert.ok(list.length >= 50);
  assert.ok(k.attendus > 0 && k.signes > 0 && k.signes < k.attendus);
  assert.ok(k.vigilance + k.bloques > 0);
  assert.equal(k.ordre, 1);
  assert.ok(k.fermes > 0);
  assert.equal(k.daysToSignature, 136);
  assert.ok(list.every((c) => c.values.client && c.values.division));
});
