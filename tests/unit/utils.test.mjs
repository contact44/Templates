import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, diffDays, fmtCountdown, fmtDate, fmtMoneyK, norm, parseDateInput, parseTSV, setToday, slugKey, startOfWeek, toCSV, toTSV,
} from '../../site/assets/js/core/utils.js';

setToday('2026-10-16');

test('dates : calculs en jours, début de semaine', () => {
  assert.equal(diffDays('2026-10-16', '2027-03-01'), 136);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(startOfWeek('2026-10-18'), '2026-10-12');
  assert.equal(startOfWeek('2026-10-12'), '2026-10-12');
});

test('dates : formats français', () => {
  assert.equal(fmtDate('2027-03-01'), '01/03/2027');
  assert.equal(fmtDate('2027-03-01', 'long'), '1er mars 2027');
  assert.equal(fmtDate('2026-12-15', 'medium'), '15 déc. 2026');
  assert.equal(fmtCountdown(0), "Aujourd'hui");
  assert.equal(fmtCountdown(5), 'J-5');
  assert.equal(fmtCountdown(-2), 'J+2');
});

test('dates : saisies acceptées', () => {
  const cases = {
    '01/12/2026': '2026-12-01', '1/12/26': '2026-12-01', '2026-12-01': '2026-12-01', '01.12.2026': '2026-12-01',
    '1er décembre 2026': '2026-12-01', '01/12': '2026-12-01', '1/3': '2027-03-01', '+7': '2026-10-23', 'j+2': '2026-10-18',
    '+2s': '2026-10-30', demain: '2026-10-17', "aujourd'hui": '2026-10-16', '46357': '2026-12-01',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(parseDateInput(input), expected, input);
  assert.equal(parseDateInput(46357), '2026-12-01', 'numéro de série Excel');
  assert.equal(parseDateInput('31/02/2026'), null);
  assert.equal(parseDateInput('n’importe quoi'), null);
  assert.equal(parseDateInput(new Date(Date.UTC(2026, 11, 1))), '2026-12-01');
});

test('textes : normalisation et clés', () => {
  assert.equal(norm('  Électroménager  (DA) '), 'electromenager (da)');
  assert.equal(slugKey('Remise de fin d’année (%)'), 'remise_de_fin_d_annee');
  assert.equal(slugKey('Statut', ['statut']), 'statut_2');
  assert.equal(fmtMoneyK(850), '850 k€');
  assert.equal(fmtMoneyK(12450).replace(/\s/g, ' '), '12,5 M€');
});

test('presse-papiers Excel : TSV avec guillemets et retours à la ligne', () => {
  const rows = parseTSV('Client\tCommentaire\r\nAlto\t"Ligne 1\nLigne 2"\r\n"Brio ""B"""\t\r\n');
  assert.deepEqual(rows, [['Client', 'Commentaire'], ['Alto', 'Ligne 1\nLigne 2'], ['Brio "B"', '']]);
  assert.equal(toTSV([['a', 'b\tc'], ['d"e', '']]), 'a\t"b\tc"\n"d""e"\t');
  assert.ok(toCSV([['a;b', 'c']]).startsWith('﻿"a;b";c'));
});
