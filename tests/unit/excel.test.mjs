import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSettings, listOptions } from '../../site/assets/js/core/schema.js';
import { deriveAll } from '../../site/assets/js/core/compute.js';
import { autoMap, buildImport, detectHeaderRow, dropUnusedPlaceholders, exportWorkbook, inferType, parseDelimited, readSpreadsheet } from '../../site/assets/js/core/excel.js';

const require = createRequire(import.meta.url);
globalThis.ExcelJS = require('exceljs');

const s = defaultSettings();
const GEN = listOptions(s, 'statut').map((o) => o.value);

// Intitulés de la ligne 4 de l'onglet « 1.Suivi CM » (bandeaux de thématiques et colonnes « auto » compris).
const HEADERS = [
  'Réf.', 'CLIENT', 'DIVISION', 'Statut du compte 2027', 'Année de fermeture', 'KAM', 'DIV Leader', 'CM référent', 'Juriste(s) référent(s) (binôme)', 'JURISTE',
  'Attribution CM/Juriste 2026', 'Attribution CM/Juriste 2027', 'ÉQUIPE', 'N° requête SELMS 2027', 'Objet de la requête', 'REPORT PAR DIV', 'REPORT GEN', 'PAF 2027 ISO 2026 ?',
  'Date dernière action', 'Prochaine relance', 'Alerte (auto)', 'Suivi du CM 2027', 'SUIVI 2027', 'Réception CC', 'Revue attribuée', 'Revue terminée', 'Durée revue (j, auto)',
  'Approval lancée', 'Approval terminée', 'Durée approval (j, auto)', 'Mise en signature', 'Signature client', 'Signature SEF', 'Durée signature (j, auto)', 'Durée totale (j, auto)', 'JALONS',
  'Contrat SEF / Client', 'Signature PAF SEF ?', 'Contrat multi-divisions', 'Contrat pluriannuel', 'Période contractuelle', 'Annexe GàG N-1', '% max GàG 2026', '% max GàG 2027', 'RSF only',
  'Délai de paiement dérogatoire', 'Volet logistique', 'Volet SAV', 'Documentation attendue pour la signature', 'Spécificité client', 'CONTRAT', 'Signataire contrat (côté client)',
  'Signature électr. gérée par (2026)', 'Signature électr. gérée par (2027)', 'Contrat édité ?', 'SIGNATURE', 'Activité', 'Code GERP', 'Client TOP 30', 'Indépendant',
  'Contrat avec centrale de référencement', 'Entité signataire du contrat', 'Accord international', 'Commentaires (base Comptes Clients)', 'IDENTIF.', 'Forme sociale', 'Capital social (€)',
  'Ville RCS', 'N° RCS', 'Siège social', 'Code postal', 'Ville', 'JURIDIQUE', 'Identifiant contrat 2026', 'Objet de la requête 2026', 'Report GEN 2026', 'Report par DIV 2026', 'PAF ISO 2025 ?',
  'Attribution CM/Juriste 2025', 'Réception CC 2026', 'Revue attribuée 2026', 'Revue terminée 2026', 'Approval lancée 2026', 'Approval terminée 2026', 'Mise en signature 2026',
  'Signature client 2026', 'Signature SEF 2026', 'Durée totale 2026 (j, auto)', 'Suivi du CM 2026', 'HISTO 2026', 'Statut modifié le (auto, macro)', 'Jours au stade actuel (auto)',
  'Signature 2026 + 1 an (auto)', 'Écart vs 2026 (j, auto)', 'Contrôle des jalons (auto)', 'PILOTAGE',
];

test('ligne d’en-tête détectée sous le titre et le bandeau des thématiques', () => {
  const rows = [['Suivi Contract Management'], [], ['CLÉ', '', '', 'ÉQUIPE'], HEADERS, ['1', 'ALTO', 'AV']];
  assert.equal(detectHeaderRow(rows), 3);
});

test('correspondance automatique avec les intitulés du classeur « Suivi CM »', () => {
  const m = autoMap(HEADERS, s);
  const at = (h) => m[HEADERS.indexOf(h)];
  const expected = {
    'Réf.': 'ref', CLIENT: 'client', DIVISION: 'division', 'Statut du compte 2027': 'statutCompte', 'CM référent': 'cm', JURISTE: 'juriste',
    'REPORT PAR DIV': 'reportDiv', 'REPORT GEN': 'statut', 'Réception CC': 'receptionCc', 'Signature SEF': 'signatureSef',
    '% max GàG 2027': 'gag2027', 'Client TOP 30': 'top30', 'Capital social (€)': 'capital', 'Report GEN 2026': 'n1ReportGen', 'Signature SEF 2026': 'n1SignatureSef',
    'Suivi du CM 2026': 'n1SuiviCm', 'Suivi du CM 2027': 'suiviCm', 'Statut modifié le (auto, macro)': 'statutModifieLe',
  };
  for (const [h, key] of Object.entries(expected)) assert.equal(at(h), key, h);
  for (const h of ['Alerte (auto)', 'Durée revue (j, auto)', 'Jours au stade actuel (auto)', 'Contrôle des jalons (auto)']) assert.equal(at(h), '', `${h} : colonne calculée, non importée`);
  const used = m.filter((x) => x && x !== '__new__');
  assert.equal(new Set(used).size, used.length, 'chaque colonne n’est utilisée qu’une fois');
});

test('les colonnes séparatrices vides ne créent pas de colonnes', () => {
  const headers = ['CLIENT', 'ÉQUIPE', 'KAM'];
  assert.deepEqual(autoMap(headers, s, [['ALTO', '', 'Paul'], ['BRIO', null, '']]), ['client', '', 'kam']);
});

test('type deviné pour les nouvelles colonnes', () => {
  assert.equal(inferType(['01/12/2026', '15/01/2027', '']), 'date');
  assert.equal(inferType(['12', '1 200,5', '3']), 'number');
  assert.equal(inferType(['Oui', 'Non', 'oui', 'non']), 'checkbox');
  assert.equal(inferType(['A', 'B', 'A', 'B', 'A', 'C']), 'select');
  assert.equal(inferType(['https://a.fr', 'www.b.fr']), 'url');
});

test('import : lignes typées, CM et juristes créés, lignes sans client ignorées', () => {
  const headers = ['Réf.', 'CLIENT', 'DIVISION', 'Statut du compte 2027', 'CM référent', 'JURISTE', 'REPORT GEN', 'Réception CC', '% max GàG 2027', 'Client TOP 30', 'Colonne maison'];
  const data = [
    ['1', 'ALTO', 'AV', 'Actif', 'Camille Laurent', 'Sophie Martin', GEN[3], new Date(Date.UTC(2026, 11, 3)), 0.12, 'X', 'a'],
    ['2', 'ALTO', 'MO (LED)', 'Fermé', 'Julien Moreau', '', '', '', '', '', 'b'],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['4', '', 'AV', '', '', '', '', '', '', '', ''],
  ];
  const r = buildImport(s, headers, data, autoMap(headers, s, data));
  assert.equal(r.rows.length, 2);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.newMembers.map((m) => m.name), ['Camille Laurent', 'Julien Moreau']);
  assert.equal(r.rows[0].cm, r.newMembers[0].id);
  assert.deepEqual(r.addedValues.juriste, ['Sophie Martin']);
  assert.equal(r.rows[0].receptionCc, '2026-12-03');
  assert.equal(r.rows[0].gag2027, 0.12);
  assert.equal(r.rows[0].top30, true);
  assert.equal(r.rows[0].statut, GEN[3]);
  assert.equal(r.rows[1].statutCompte, 'Fermé');
  assert.equal(r.rows[1].top30, undefined);
  assert.equal(r.newColumns[0].label, 'Colonne maison');
});

test('noms d’exemple (CM 1, Juriste 1) remplacés par ceux du fichier', () => {
  const headers = ['CLIENT', 'CM référent', 'JURISTE'];
  const data = [['ALTO', 'Camille Laurent', 'Sophie Martin'], ['BRIO', 'Julien Moreau', '']];
  const r = buildImport(s, headers, data, autoMap(headers, s, data));
  dropUnusedPlaceholders(r.settings, r.rows);
  assert.deepEqual(r.settings.team.map((m) => m.name), ['Camille Laurent', 'Julien Moreau']);
  assert.deepEqual(r.settings.lists.juriste.map((o) => o.value), ['Sophie Martin']);
  // Un nom d'exemple encore utilisé par une ligne est conservé.
  const r2 = buildImport(s, headers, data, autoMap(headers, s, data));
  const kept = dropUnusedPlaceholders(r2.settings, [...r2.rows, { juriste: 'Juriste 1' }]);
  assert.deepEqual(kept.lists.juriste.map((o) => o.value), ['Juriste 1', 'Sophie Martin']);
});

test('CSV au format Excel français', () => {
  assert.deepEqual(parseDelimited('Client;Statut\n"Alto; SA";Signé\n'), [['Client', 'Statut'], ['Alto; SA', 'Signé']]);
});

test('export Excel puis relecture : en-têtes, valeurs et onglets de reporting', async () => {
  const contracts = [
    { id: 'a', values: { ref: '1', client: 'ALTO', division: 'AV', statutCompte: 'Actif', statut: GEN[3], receptionCc: '2026-12-01', gag2027: 0.2, top30: true } },
    { id: 'b', values: { ref: '2', client: 'BRIO', division: 'TE', statutCompte: 'Fermé', anneeFermeture: 2026 } },
  ];
  const blob = await exportWorkbook({ settings: s, contracts, derived: deriveAll(s, contracts, '2026-10-16'), today: '2026-10-16' });
  const buf = Buffer.from(await blob.arrayBuffer());
  const { sheets } = await readSpreadsheet({ name: 'export.xlsx', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  const names = sheets.map((x) => x.name);
  assert.ok(names.includes('1.Suivi CM'));
  assert.ok(names.includes('Reporting général'));
  assert.ok(names.includes('Charge équipe'));
  const suivi = sheets.find((x) => x.name === '1.Suivi CM');
  const h = detectHeaderRow(suivi.rows);
  const headers = suivi.rows[h].map((x) => String(x ?? ''));
  const iClient = headers.indexOf('CLIENT');
  assert.ok(iClient >= 0);
  const data = suivi.rows.slice(h + 1).filter((r) => r[iClient]);
  assert.deepEqual(data.map((r) => r[iClient]), ['ALTO', 'BRIO']);
  // L'export se réimporte tel quel : même correspondance des colonnes.
  const back = buildImport(s, headers, data, autoMap(headers, s, data));
  assert.equal(back.rows[0].receptionCc, '2026-12-01');
  assert.equal(back.rows[0].gag2027, 0.2);
  assert.equal(back.rows[0].top30, true);
  assert.equal(back.rows[1].anneeFermeture, 2026);
  assert.equal(back.newColumns.length, 0);
});

test('import : une valeur de la saison précédente ne modifie pas les étapes de la saison', () => {
  const headers = ['CLIENT', 'REPORT PAR DIV', 'Report par DIV 2026'];
  const data = [['ALTO', '2.Attente Contrat Client', '11.Attente signature Client']];
  const r = buildImport(s, headers, data, autoMap(headers, s, data));
  assert.equal(r.rows[0].n1ReportDiv, '11.Attente signature Client');
  assert.equal(r.addedValues.reportDiv, undefined);
  assert.equal(r.settings.lists.reportDiv.length, 15);
});
