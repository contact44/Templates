// Lecture et écriture des classeurs Excel (ExcelJS embarqué, chargé à la demande).
// Import : détection de la ligne d'en-tête, correspondance automatique des colonnes, typage.
// Export : classeur mis en forme (en-têtes, filtres, volets figés, listes déroulantes, alertes).

import { FIELD_GROUPS, groupById, listOptions, REPORT_STAGES, stageLabel, SWATCHES } from './schema.js';
import {
  cellTone, coerceValue, displayValue, kpis, reportByGroup, statusRowsForTab, workload,
} from './compute.js';
import {
  fmtDate, fmtDateTime, isEmpty, isISODate, norm, parseDateInput, parseNumberInput, slugKey, toCSV, todayISO,
} from './utils.js';

let loading = null;
export function loadExcelJS() {
  if (globalThis.ExcelJS) return Promise.resolve(globalThis.ExcelJS);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('vendor/exceljs.min.js', document.baseURI).href;
      s.onload = () => (globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(new Error('ExcelJS indisponible')));
      s.onerror = () => { loading = null; reject(new Error('Impossible de charger le module Excel (vendor/exceljs.min.js).')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/* ------------------------------------------------------------------ Lecture */

export class ImportError extends Error {}

function bytesStartWith(bytes, text) {
  for (let i = 0; i < text.length; i++) if (bytes[i] !== text.charCodeAt(i)) return false;
  return true;
}

/** Valeur brute d'une cellule ExcelJS → texte, nombre, booléen ou Date. */
export function cellToPlain(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellToPlain(v.result);
    if ('text' in v && v.hyperlink) return v.hyperlink.startsWith('mailto:') ? v.text : v.hyperlink;
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
    return '';
  }
  return v;
}

/** Lit un fichier .xlsx / .xlsm / .csv / .txt → { sheets: [{ name, rows }] }. */
export async function readSpreadsheet(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (bytesStartWith(buf, '<## NASCA DRM')) {
    throw new ImportError('Ce fichier est protégé par le DRM Samsung (NASCA) : son contenu est chiffré et ne peut pas être lu par le navigateur. Ouvrez-le dans Excel, sélectionnez le tableau (Ctrl+A puis Ctrl+C) et collez-le dans l’onglet « Coller depuis Excel », ou enregistrez une copie non protégée si votre politique de sécurité le permet.');
  }
  const name = file.name || '';
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (/\.(csv|txt|tsv)$/i.test(name) || !isZip) {
    if (!isZip && buf[0] === 0xd0 && buf[1] === 0xcf) throw new ImportError('Les anciens classeurs .xls (Excel 97-2003) ne sont pas pris en charge : enregistrez le fichier au format .xlsx puis réessayez.');
    const text = decodeText(buf);
    return { sheets: [{ name: name || 'CSV', rows: parseDelimited(text) }] };
  }
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf.buffer); } catch (err) {
    throw new ImportError(`Lecture du classeur impossible (${err.message}). Vérifiez qu’il s’agit bien d’un fichier .xlsx ou .xlsm non protégé.`);
  }
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    const rows = [];
    const maxRow = Math.min(ws.rowCount, 5000);
    for (let r = 1; r <= maxRow; r++) {
      const row = ws.getRow(r);
      const out = [];
      const n = Math.min(row.cellCount || 0, 120);
      for (let c = 1; c <= n; c++) out.push(cellToPlain(row.getCell(c).value));
      rows.push(out);
    }
    sheets.push({ name: ws.name, rows });
  });
  if (!sheets.length) throw new ImportError('Aucune feuille visible dans ce classeur.');
  return { sheets };
}

function decodeText(buf) {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return text.replace(/^﻿/, '');
}

export function parseDelimited(text) {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const counts = { '\t': (first.match(/\t/g) || []).length, ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length };
  const sep = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Index de la ligne d'en-tête : la plus « textuelle » parmi les 20 premières lignes. */
export function detectHeaderRow(rows) {
  let best = 0; let bestScore = -1;
  for (let i = 0; i < Math.min(20, rows.length); i++) {
    // Intitulés distincts : un bandeau de cellules fusionnées (« CLÉ », « CLÉ »…) ne compte qu'une fois par valeur.
    const cells = [...new Set(rows[i].filter((v) => typeof v === 'string' && v.trim() && v.trim().length < 80).map((v) => v.trim()))];
    const nonEmpty = rows[i].filter((v) => v !== '' && v !== null && v !== undefined).length;
    const score = cells.length * 2 - (nonEmpty - cells.length) + (rows[i + 1]?.filter((v) => v !== '').length ? 1 : 0);
    if (cells.length >= 2 && score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

// Autres intitulés reconnus (fichiers plus anciens, exports, saisies libres). Les intitulés du classeur
// « Suivi CM » sont reconnus tels quels (mêmes libellés que les colonnes).
const SYNONYMS = {
  ref: ['ref', 'reference', 'n°', 'no', 'numero', 'id'],
  client: ['client', 'clients', 'enseigne', 'nom client', 'raison sociale', 'customer', 'compte'],
  division: ['division', 'div', 'bu', 'business unit'],
  statutCompte: ['statut du compte', 'statut compte', 'statut du compte 2027', 'statut du compte 2028'],
  cm: ['cm referent', 'contract manager', 'cm'],
  juriste: ['juriste'],
  statut: ['report gen', 'reporting general', 'statut general', 'statut gen'],
  reportDiv: ['report par div', 'report div', 'reporting par div', 'statut par division'],
  statutModifieLe: ['statut modifie le', 'statut modifie le auto, macro', 'statut modifie le auto macro'],
  suiviCm: ['suivi du cm', 'suivi du cm 2027', 'suivi'],
  kam: ['kam', 'commercial', 'key account manager'],
};

const headerKey = (x) => norm(x).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Propose une colonne cible pour chaque en-tête : clé existante, '__new__' ou ''.
 * Les colonnes calculées (« auto ») et les colonnes sans aucune donnée (séparateurs) sont ignorées.
 */
export function autoMap(headers, settings, dataRows = null) {
  const candidates = [];
  const computed = new Set(settings.columns.filter((c) => c.type === 'computed').map((c) => headerKey(c.label)));
  const skip = new Set();
  headers.forEach((h, i) => {
    const nh = headerKey(h);
    if (!nh) return;
    const stamped = (SYNONYMS.statutModifieLe || []).map(headerKey).includes(nh); // horodatage de la macro : donnée à reprendre
    if (computed.has(nh) || (/\bauto\b/.test(nh) && !stamped)) { skip.add(i); return; }
    if (dataRows && !dataRows.some((r) => r[i] !== '' && r[i] !== null && r[i] !== undefined)) { skip.add(i); return; }
    for (const col of settings.columns) {
      if (col.type === 'computed') continue;
      const names = [headerKey(col.label), headerKey(col.key), ...(SYNONYMS[col.key] || []).map(headerKey)];
      let score = 0;
      for (const n of names) {
        if (!n) continue;
        if (nh === n) score = Math.max(score, 100);
        else if (n.length > 3 && new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(nh)) score = Math.max(score, 60 + Math.min(30, n.length));
        else if (n.length > 6 && nh.includes(n)) score = Math.max(score, 55);
      }
      if (score >= 55) candidates.push({ i, key: col.key, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const mapping = headers.map((h, i) => (headerKey(h) && !skip.has(i) ? '__new__' : ''));
  const used = new Set(); const done = new Set();
  for (const c of candidates) {
    if (used.has(c.key) || done.has(c.i)) continue;
    mapping[c.i] = c.key; used.add(c.key); done.add(c.i);
  }
  return mapping;
}

/** Devine le type d'une nouvelle colonne d'après ses valeurs. */
export function inferType(values) {
  const vals = values.map((v) => (v instanceof Date ? v : typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '' && v !== null && v !== undefined);
  if (!vals.length) return 'text';
  const ratio = (fn) => vals.filter(fn).length / vals.length;
  // Les nombres d'abord : « 2.5 » ou « 12,5 » ne sont pas des dates.
  if (ratio((v) => typeof v === 'number' || (typeof v === 'string' && /\d/.test(v) && parseNumberInput(v) !== null)) > 0.8) return 'number';
  if (ratio((v) => v instanceof Date || (typeof v === 'string' && parseDateInput(v) && /\d/.test(v) && /[/.-]/.test(v))) > 0.7) return 'date';
  if (ratio((v) => typeof v === 'boolean' || ['oui', 'non', 'x', 'yes', 'no'].includes(norm(v))) > 0.8) return 'checkbox';
  if (ratio((v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v))) > 0.7) return 'email';
  if (ratio((v) => /^(https?:\/\/|www\.)/i.test(String(v))) > 0.7) return 'url';
  const distinct = new Set(vals.map((v) => norm(v)));
  if (vals.length >= 4 && distinct.size <= Math.max(3, Math.min(14, vals.length / 2.5))) return 'select';
  const avg = vals.reduce((a, v) => a + String(v).length, 0) / vals.length;
  return avg > 60 ? 'longtext' : 'text';
}

/**
 * Prépare l'import : nouvelles colonnes, nouvelles valeurs de listes, lignes typées.
 * mapping[i] = clé de colonne, '__new__' (créer) ou '' (ignorer).
 */
export function buildImport(settings, headers, dataRows, mapping) {
  const s = JSON.parse(JSON.stringify(settings));
  const newColumns = [];
  const keys = mapping.map((m, i) => {
    if (m !== '__new__') return m;
    const label = String(headers[i]).trim() || `Colonne ${i + 1}`;
    const type = inferType(dataRows.map((r) => r[i]));
    const key = slugKey(label, [...s.columns.map((c) => c.key), ...newColumns.map((c) => c.key)]);
    const col = { key, label, type, width: type === 'longtext' ? 220 : 150, group: 'autres', imported: true };
    if (type === 'select') { col.list = key; s.lists[key] = []; s.listLabels = { ...(s.listLabels || {}), [key]: label }; }
    newColumns.push(col);
    s.columns.push(col);
    return key;
  });
  const addedValues = {};
  const newMembers = [];
  const addMissing = (listKey, value) => {
    if (listKey === '__team__') {
      const name = String(value).trim();
      let m = [...s.team, ...newMembers].find((t) => norm(t.name) === norm(name));
      if (!m) {
        m = { id: slugKey(name, [...s.team, ...newMembers].map((t) => t.id)), name, email: /@/.test(name) ? name : '', github: '', initials: '', color: SWATCHES[(s.team.length + newMembers.length) % 8], role: 'Contract Manager' };
        newMembers.push(m);
      }
      return m.id;
    }
    const list = s.lists[listKey] || (s.lists[listKey] = []);
    if (!list.some((o) => norm(o.value) === norm(value))) {
      list.push({ value: String(value).trim(), color: SWATCHES[list.length % 8], ...(listKey === 'statut' || listKey === 'reportDiv' ? { stage: 'active' } : {}), ...(listKey === 'statutCompte' ? { role: '' } : {}) });
      (addedValues[listKey] = addedValues[listKey] || []).push(String(value).trim());
    }
    return String(value).trim();
  };
  const sWithMembers = () => ({ ...s, team: [...s.team, ...newMembers] });
  const out = [];
  let skipped = 0;
  for (const r of dataRows) {
    if (!r.some((v) => v !== '' && v !== null && v !== undefined)) continue;
    const values = {};
    keys.forEach((key, i) => {
      if (!key) return;
      const col = s.columns.find((c) => c.key === key);
      if (!col) return;
      const raw = r[i];
      if (raw === '' || raw === null || raw === undefined) return;
      if (col.key === 'ref') { values.ref = String(raw).trim(); return; }
      // Historique de la saison précédente : valeur conservée telle quelle, sans modifier les listes de la saison.
      const keep = col.group === 'histo' && col.type === 'select' ? (lk, v) => String(v).trim() : addMissing;
      const v = coerceValue(sWithMembers(), col, raw instanceof Date ? raw : typeof raw === 'number' && col.type === 'date' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? raw : String(raw), { addMissing: keep });
      if (v !== undefined && v !== null && v !== false && !(Array.isArray(v) && !v.length)) values[key] = v;
    });
    if (isEmpty(values.client)) { skipped++; continue; }
    out.push(values);
  }
  s.team = [...s.team, ...newMembers];
  return { settings: s, rows: out, newColumns, addedValues, newMembers, skipped };
}

/**
 * Après un import : retire les valeurs d'exemple livrées avec l'outil (« CM 1 », « CM 2 », « Juriste 1 »…)
 * quand le fichier apporte les vrais noms et qu'aucune ligne ne les utilise.
 */
export function dropUnusedPlaceholders(settings, rows) {
  const s = settings;
  const used = (key, v) => rows.some((r) => r[key] === v);
  const memberPlaceholder = (m) => /^(CM \d+|Contract Manager \d+)$/.test(m.name || '');
  if (s.team.some((m) => !memberPlaceholder(m))) s.team = s.team.filter((m) => !memberPlaceholder(m) || used('cm', m.id));
  const jur = s.lists.juriste || [];
  if (jur.some((o) => !/^Juriste \d+$/.test(o.value))) s.lists.juriste = jur.filter((o) => !/^Juriste \d+$/.test(o.value) || used('juriste', o.value));
  return s;
}

/* ----------------------------------------------------------------- Écriture */

function tint(hex, amount = 0.82) {
  const h = String(hex || '#a3a7af').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  const r = (n >> 16) & 255; const g = (n >> 8) & 255; const b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `FF${[mix(r), mix(g), mix(b)].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
const BLUE = 'FF1428A0';
const isoToExcelDate = (iso) => (isISODate(iso) ? new Date(`${iso}T00:00:00Z`) : null);
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const argb = (hex) => `FF${String(hex).replace('#', '').toUpperCase()}`;
const TONE_FILL = {
  'tone-danger': ['FFFFC7CE', 'FF9C0006'], 'tone-danger-strong': ['FFC00000', 'FFFFFFFF'], 'tone-warning': ['FFFFEB9C', 'FF9C5700'],
  'tone-warning-soft': ['FFFFF2CC', 'FF7F6000'], 'tone-success': ['FFC6EFCE', 'FF006100'], 'tone-info': ['FFDDEBF7', 'FF1F4E79'],
  'tone-yellow': ['FFFFF2CC', null], 'tone-green': ['FFE2EFDA', null], 'tone-purple': [null, 'FF7030A0'], 'tone-danger-text': [null, 'FFC00000'],
};

/** Valeur Excel d'une cellule du suivi (dates en dates, pourcentages en nombres, calculs en valeurs). */
function excelValue(s, c, col, d) {
  const v = c.values[col.key];
  switch (col.type) {
    case 'date': return isoToExcelDate(v);
    case 'number': case 'percent': return isEmpty(v) ? null : Number(v);
    case 'checkbox': return v ? (col.trueLabel || 'X') : null;
    case 'url': return isEmpty(v) ? null : { text: String(v), hyperlink: String(v) };
    case 'computed': {
      if (['dureeRevue', 'dureeApproval', 'dureeSignature', 'dureeTotale', 'n1DureeTotale', 'joursStade', 'ecartN1'].includes(col.computed)) return d?.[col.computed] ?? null;
      if (col.computed === 'sigN1Plus1') return isoToExcelDate(d?.sigN1Plus1);
      return displayValue(s, c, col, d) || null;
    }
    default: return displayValue(s, c, col, d) || null;
  }
}

export async function exportWorkbook({ settings, contracts, derived, history = [], filtersLabel = '', today = todayISO() }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suivi Contract Management';
  wb.created = new Date();
  const s = settings;
  const year = s.season.year;
  // Colonnes dans l'ordre des thématiques (comme le classeur d'origine).
  const cols = [...s.columns].sort((a, b) => FIELD_GROUPS.findIndex((g) => g.id === (a.group || 'autres')) - FIELD_GROUPS.findIndex((g) => g.id === (b.group || 'autres')));

  /* Plages des listes déroulantes (la feuille « Listes déroulantes » est écrite en dernier). */
  const listKeys = Object.keys(s.lists || {});
  const listRange = {};
  listKeys.forEach((k, i) => {
    const n = listOptions(s, k).length;
    if (n) listRange[k] = `'Listes déroulantes'!$${colLetter(i + 1)}$2:$${colLetter(i + 1)}$${n + 1}`;
  });
  const teamCol = listKeys.length + 1;
  const teamRange = (s.team || []).length ? `'Listes déroulantes'!$${colLetter(teamCol)}$2:$${colLetter(teamCol)}$${s.team.length + 1}` : null;

  /* Feuille 1.Suivi CM. */
  const frozen = cols.filter((c) => c.group === 'cle').length;
  const ws = wb.addWorksheet('1.Suivi CM', { properties: { tabColor: { argb: BLUE } }, views: [{ state: 'frozen', xSplit: frozen, ySplit: 4, showGridLines: false }] });
  const HEADER_ROW = 4;
  ws.getCell('A1').value = `SUIVI CM — ${String(s.season.name || '').toUpperCase()}`;
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: BLUE } };
  ws.getCell('A2').value = `${s.season.entity || ''}${s.season.entity ? ' · ' : ''}Export du ${fmtDateTime(Date.now())} · ${contracts.length} ligne(s)${filtersLabel ? ` · ${filtersLabel}` : ''}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF5B5F68' } };
  ws.getRow(1).height = 26;
  // Bandeau des thématiques (ligne 3) puis intitulés (ligne 4).
  let start = 1;
  cols.forEach((col, i) => {
    const next = cols[i + 1];
    if (!next || next.group !== col.group) {
      const g = groupById(col.group);
      if (i + 1 > start) ws.mergeCells(3, start, 3, i + 1);
      const cell = ws.getCell(3, start);
      cell.value = g.label.toUpperCase();
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(g.color) } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      start = i + 2;
    }
  });
  ws.getRow(3).height = 20;
  const header = ws.getRow(HEADER_ROW);
  cols.forEach((col, i) => {
    const g = groupById(col.group);
    const cell = header.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: 'FF1F2937' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(g.color, 0.82) } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } }, bottom: { style: 'thin', color: { argb: argb(g.color) } } };
    const column = ws.getColumn(i + 1);
    column.width = Math.max(8, Math.round((col.width || 140) / 7.2));
    // Thématiques repliables dans Excel (comme les boutons du classeur d'origine).
    if (col.group !== 'cle') column.outlineLevel = 1;
  });
  header.height = 42;

  contracts.forEach((c, r) => {
    const row = ws.getRow(HEADER_ROW + 1 + r);
    const d = derived.get(c.id);
    cols.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.value = excelValue(s, c, col, d);
      if (col.type === 'date' || col.computed === 'sigN1Plus1') cell.numFmt = 'dd/mm/yyyy';
      if (col.type === 'percent') cell.numFmt = '0.0%';
      if (col.type === 'number') cell.numFmt = col.unit === '€' ? '#,##0 "€"' : '#,##0';
      if (col.computed === 'ecartN1') cell.numFmt = '+0" j";-0" j";0" j"';
      cell.alignment = { vertical: 'top', wrapText: col.type === 'longtext' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9DBE1' } } };
      const tone = d?.closed ? '' : cellTone(s, c, col, d);
      const f = TONE_FILL[tone];
      if (d?.closed) { cell.font = { color: { argb: 'FF8C8C8C' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }; }
      else if (f) {
        if (f[0]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f[0] } };
        if (f[1]) cell.font = { color: { argb: f[1] }, bold: tone === 'tone-danger-text' || tone === 'tone-purple' };
      }
      if (col.key === 'division' && !d?.closed) {
        const color = listOptions(s, 'division').find((o) => o.value === c.values.division)?.color;
        if (color) cell.font = { bold: true, color: { argb: argb(color) } };
      }
      if (col.key === 'client') cell.font = { ...(cell.font || {}), bold: true };
    });
  });
  const lastRow = HEADER_ROW + Math.max(1, contracts.length);
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: cols.length } };
  cols.forEach((col, i) => {
    const L = colLetter(i + 1);
    const ref = `${L}${HEADER_ROW + 1}:${L}${lastRow + 200}`;
    if (col.type === 'select' && listRange[col.list]) ws.dataValidations.add(ref, { type: 'list', allowBlank: true, formulae: [listRange[col.list]], showErrorMessage: false });
    if (col.type === 'person' && teamRange) ws.dataValidations.add(ref, { type: 'list', allowBlank: true, formulae: [teamRange], showErrorMessage: false });
    if (col.type === 'date' && !col.readonly) ws.dataValidations.add(ref, { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorTitle: 'Date invalide', error: 'Saisissez une date (jj/mm/aaaa).' });
  });

  /* Feuille Reporting général (onglets 3 et 4 du classeur). */
  const wsR = wb.addWorksheet('Reporting général', { properties: { tabColor: { argb: 'FF0CA30C' } }, views: [{ showGridLines: false }] });
  const rep = reportByGroup(s, contracts, derived);
  const k = kpis(s, contracts, derived, today);
  wsR.getColumn(1).width = 44;
  wsR.getCell('A1').value = `État d’avancement SEF au ${fmtDate(today)}`;
  wsR.getCell('A1').font = { bold: true, size: 15, color: { argb: BLUE } };
  sectionTitle(wsR, 3, 'Synthèse');
  tableHeader(wsR, 4, ['Étape', 'Contrats / PAF', '%']);
  REPORT_STAGES.forEach((st, i) => {
    const row = wsR.getRow(5 + i);
    row.getCell(1).value = stageLabel(s, st);
    row.getCell(2).value = rep.all.stages[st];
    row.getCell(3).value = rep.all.total ? rep.all.stages[st] / rep.all.total : 0;
    row.getCell(3).numFmt = '0%';
  });
  wsR.getRow(9).values = ['Total', rep.all.total];
  wsR.getRow(9).font = { bold: true };
  const colsR = [{ ...rep.all, label: 'TOTAL SEF' }];
  for (const f of rep.families) { colsR.push({ ...f }); for (const g of rep.groups.filter((x) => x.family === f.key)) colsR.push(g); }
  sectionTitle(wsR, 11, 'Suivi général par division');
  tableHeader(wsR, 12, ['', ...colsR.map((x) => x.label)]);
  wsR.getRow(13).values = ['Nombre de contrats / PAF', ...colsR.map((x) => x.total)];
  wsR.getRow(14).values = ['Nombre de contrats / PAF signés', ...colsR.map((x) => x.signed)];
  wsR.getRow(15).values = ['% contrats signés', ...colsR.map((x) => (x.total ? x.signed / x.total : null))];
  colsR.forEach((_, i) => { wsR.getCell(15, i + 2).numFmt = '0%'; wsR.getColumn(i + 2).width = 12; });
  sectionTitle(wsR, 17, 'Statut par division');
  tableHeader(wsR, 18, ['Statut', ...colsR.map((x) => x.label)]);
  let n = 0;
  statusRowsForTab(s).forEach((r, i) => {
    n++;
    const label = r.merged ? `${n}.${stageLabel(s, r.stage)}` : r.value;
    wsR.getRow(19 + i).values = [label, ...colsR.map((x) => r.values.reduce((a, v) => a + (x.statuses[v] || 0), 0))];
    wsR.getCell(19 + i, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(r.color, 0.78) } };
  });

  /* Feuille Charge équipe (onglet 9 du classeur). */
  const wsC = wb.addWorksheet('Charge équipe', { properties: { tabColor: { argb: 'FF7030A0' } }, views: [{ showGridLines: false }] });
  wsC.getColumn(1).width = 30;
  wsC.getCell('A1').value = `Charge de l’équipe — ${s.season.name}`;
  wsC.getCell('A1').font = { bold: true, size: 15, color: { argb: BLUE } };
  wsC.getCell('A2').value = `Comptes « Actif » uniquement · seuils : à surveiller ≥ ${s.alerts.vigilanceDays} j, bloqué ≥ ${s.alerts.blocageDays} j au même stade`;
  const headC = ['Comptes actifs', 'Signés / clôturés', '% signés', 'Attente CC / contrat', 'Revue & approval', 'En signature', 'Sans statut', 'À surveiller', 'Bloqués', `En retard vs ${year - 1}`];
  const keysC = ['actifs', 'signes', 'pct', 'attente', 'traitement', 'signature', 'sansStatut', 'vigilance', 'bloques', 'retard'];
  let line = 4;
  for (const [title, by] of [['Par CM référent', 'cm'], ['Par juriste', 'juriste']]) {
    const w = workload(s, contracts, derived, by);
    sectionTitle(wsC, line, title);
    tableHeader(wsC, line + 1, [by === 'cm' ? 'CM référent' : 'Juriste', ...headC]);
    [...w.rows, w.total].forEach((r, i) => {
      const row = wsC.getRow(line + 2 + i);
      row.values = [r.label, ...keysC.map((kk) => r[kk])];
      row.getCell(4).numFmt = '0%';
      if (r.key === '__total__') row.font = { bold: true };
    });
    keysC.forEach((_, i) => { wsC.getColumn(i + 2).width = 14; });
    line += w.rows.length + 4;
  }
  void k;

  /* Feuille Journal. */
  const wsH = wb.addWorksheet('Journal', { properties: { tabColor: { argb: 'FFEB6834' } }, views: [{ state: 'frozen', ySplit: 1 }] });
  const hHead = ['Date et heure', 'Utilisateur', 'Réf.', 'Compte', 'Action', 'Champ', 'Ancienne valeur', 'Nouvelle valeur'];
  tableHeader(wsH, 1, hHead);
  [18, 22, 8, 32, 14, 24, 34, 34].forEach((w, i) => { wsH.getColumn(i + 1).width = w; });
  const ACTIONS = { update: 'Modification', create: 'Création', delete: 'Suppression', restore: 'Restauration', comment: 'Commentaire', mail: 'Relance', import: 'Import', settings: 'Paramètres', 'restore-all': 'Données', sort: 'Tri des comptes', external: 'Modification sur GitHub' };
  history.slice(0, 5000).forEach((h, i) => {
    wsH.getRow(2 + i).values = [fmtDateTime(h.ts), h.user || '', h.contractRef || '', h.contractLabel || '', ACTIONS[h.action] || h.action, h.fieldLabel || '', h.from || '', h.to || ''];
  });
  wsH.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hHead.length } };

  /* Feuille Listes déroulantes (source des listes). */
  const wsL = wb.addWorksheet('Listes déroulantes', { properties: { tabColor: { argb: 'FF9A9DA5' } } });
  listKeys.forEach((key, i) => {
    const c = i + 1;
    const head = wsL.getCell(1, c);
    head.value = s.listLabels?.[key] || key;
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    const opts = listOptions(s, key);
    opts.forEach((o, j) => { const cell = wsL.getCell(j + 2, c); cell.value = o.value; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(o.color) } }; });
    wsL.getColumn(c).width = Math.max(14, ...opts.map((o) => o.value.length + 2));
  });
  const th = wsL.getCell(1, teamCol);
  th.value = 'CM référents';
  th.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  th.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  (s.team || []).forEach((m, j) => { wsL.getCell(j + 2, teamCol).value = m.name; });
  wsL.getColumn(teamCol).width = 26;

  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function sectionTitle(ws, row, text) {
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size: 12, color: { argb: BLUE } };
}

function tableHeader(ws, row, labels) {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  });
}

export function exportCSV({ settings, contracts, derived }) {
  const cols = settings.columns;
  const rows = [cols.map((c) => c.label), ...contracts.map((c) => cols.map((col) => displayValue(settings, c, col, derived.get(c.id))))];
  return new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
}
