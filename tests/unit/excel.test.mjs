import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../../site/assets/js/core/schema.js';
import { autoMap, buildImport, detectHeaderRow, inferType, parseDelimited } from '../../site/assets/js/core/excel.js';

const s = defaultSettings();

test('ligne d’en-tête détectée sous un titre', () => {
  const rows = [['Suivi saison 2027'], [], ['Client', 'Statut', 'Date envoi CGV'], ['Alto', 'Signé', new Date()]];
  assert.equal(detectHeaderRow(rows), 2);
});

test('correspondance automatique des intitulés usuels', () => {
  const headers = ['N°', 'Enseigne', 'Centrale', 'CM', 'KAM', 'Etat', 'Envoi CGV', 'AR CGV', 'Date signature', 'Prochaine étape', 'Deadline', 'Remarques', 'N° SELMS+', 'Colonne maison'];
  assert.deepEqual(autoMap(headers, s), ['ref', 'client', 'groupe', 'cm', 'kam', 'statut', 'dateCgv', 'dateRetourCgv', 'dateSignature', '__new__', 'echeance', 'commentaires', 'refSelms', '__new__']);
});

test('type deviné pour les nouvelles colonnes', () => {
  assert.equal(inferType(['01/12/2026', '15/01/2027', '']), 'date');
  assert.equal(inferType(['12', '1 200,5', '3']), 'number');
  assert.equal(inferType(['Oui', 'Non', 'oui', 'non']), 'checkbox');
  assert.equal(inferType(['A', 'B', 'A', 'B', 'A', 'C']), 'select');
  assert.equal(inferType(['https://a.fr', 'www.b.fr']), 'url');
});

test('import : lignes typées, nouvelles valeurs, nouveaux membres, lignes sans client ignorées', () => {
  const headers = ['Client', 'Statut', 'Canal', 'Contract manager', 'Envoi CGV', 'Remise (%)'];
  const data = [
    ['Alto', 'Négociation en cours', 'E-commerce', 'Contract Manager 1', '01/11/2026', '2,5'],
    ['Brio', 'En attente client', 'Duty free', 'Sophie Martin', '', '3'],
    ['', 'Signé', '', '', '', ''],
  ];
  const r = buildImport(s, headers, data, autoMap(headers, s));
  assert.equal(r.rows.length, 2);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.addedValues, { statut: ['En attente client'], canal: ['Duty free'] });
  assert.equal(r.newMembers[0].name, 'Sophie Martin');
  assert.equal(r.rows[1].cm, r.newMembers[0].id);
  assert.equal(r.rows[0].dateCgv, '2026-11-01');
  const remise = r.newColumns[0];
  assert.equal(remise.type, 'number');
  assert.equal(r.rows[0][remise.key], 2.5);
});

test('CSV au format Excel français', () => {
  assert.deepEqual(parseDelimited('Client;Statut\n"Alto; SA";Signé\n'), [['Client', 'Statut'], ['Alto; SA', 'Signé']]);
});
