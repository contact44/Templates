// Lecture et écriture des classeurs Excel (ExcelJS embarqué, chargé à la demande).
// Import : détection de la ligne d'en-tête, correspondance automatique des colonnes, typage.
// Export : classeur mis en forme (en-têtes, filtres, volets figés, listes déroulantes, alertes).

import { columnByKey, listOptions, milestoneByRole, SWATCHES } from './schema.js';
import { byStatus, breakdown, coerceValue, displayValue, kpis } from './compute.js';
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
    const cells = rows[i].filter((v) => typeof v === 'string' && v.trim() && v.trim().length < 80);
    const nonEmpty = rows[i].filter((v) => v !== '' && v !== null && v !== undefined).length;
    const score = cells.length * 2 - (nonEmpty - cells.length) + (rows[i + 1]?.filter((v) => v !== '').length ? 1 : 0);
    if (cells.length >= 2 && score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

const SYNONYMS = {
  ref: ['ref', 'reference', 'n°', 'no', 'numero', 'id', 'n° contrat', 'num'],
  client: ['client', 'clients', 'enseigne', 'distributeur', 'nom client', 'nom du client', 'raison sociale', 'customer', 'compte', 'partenaire', 'societe', 'cocontractant', 'retailer'],
  groupe: ['groupe', 'centrale', 'centrale d achat', 'centrale d\'achat', 'groupement', 'group'],
  canal: ['canal', 'circuit', 'channel', 'segment', 'canal de distribution'],
  division: ['division', 'divisions', 'bu', 'business unit', 'univers', 'categorie produit', 'produits'],
  typeContrat: ['type', 'type de contrat', 'type contrat', 'nature', 'nature du contrat', 'contrat', 'type d\'accord'],
  cm: ['contract manager', 'cm', 'juriste', 'responsable juridique', 'gestionnaire', 'pilote', 'legal', 'en charge', 'responsable'],
  kam: ['kam', 'commercial', 'key account', 'key account manager', 'account manager', 'sales', 'responsable commercial', 'interlocuteur commercial'],
  contactClient: ['contact', 'contact client', 'email client', 'e-mail client', 'mail client', 'email', 'e-mail'],
  priorite: ['priorite', 'priority', 'criticite', 'importance'],
  ca: ['ca', 'chiffre d affaires', 'chiffre d\'affaires', 'ca n-1', 'ca n 1', 'revenue', 'turnover', 'ca 2026', 'ca (k€)', 'ca k€'],
  statut: ['statut', 'status', 'etat', 'etat d avancement', 'avancement', 'etape', 'stade'],
  dateCgv: ['envoi cgv', 'date envoi cgv', 'date d envoi des cgv', 'cgv envoyees', 'cgv', 'date cgv', 'envoi des cgv'],
  dateRetourCgv: ['retour cgv', 'ar cgv', 'accuse de reception', 'reponse cgv', 'retour client', 'retour client sur cgv', 'date retour'],
  version: ['version', 'version en cours', 'v'],
  dateVersion: ['date version', 'derniere version', 'envoi version', 'envoi derniere version', 'date derniere version'],
  dateSignature: ['date signature', 'signature', 'signe le', 'date de signature', 'date signature convention', 'signee le'],
  prochaineAction: ['prochaine action', 'prochaines actions', 'action', 'actions', 'next step', 'next steps', 'a faire', 'next action', 'action a mener'],
  echeance: ['echeance', 'deadline', 'date limite', 'due date', 'date action', 'date de relance', 'relance', 'echeance action'],
  blocage: ['blocage', 'blocages', 'points de blocage', 'points bloquants', 'risques', 'points ouverts', 'enjeux', 'points durs'],
  commentaires: ['commentaire', 'commentaires', 'remarques', 'notes', 'observations', 'comment', 'comments', 'suivi'],
  refSelms: ['selms', 'selms+', 'n selms', 'reference selms', 'ref selms', 'n° selms+', 'numero selms'],
  lienDossier: ['lien', 'url', 'dossier', 'sharepoint', 'lien dossier', 'lien vers le dossier', 'chemin'],
};

/** Propose une colonne cible pour chaque en-tête : clé existante, '__new__' ou ''. */
export function autoMap(headers, settings) {
  const candidates = [];
  // Colonnes calculées par l'application (avancement, alertes…) : ignorées si on réimporte un export.
  const computed = new Set(settings.columns.filter((c) => c.type === 'computed').map((c) => norm(c.label)));
  const skip = new Set();
  headers.forEach((h, i) => {
    const nh = norm(h).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!nh) return;
    if (computed.has(norm(h))) { skip.add(i); return; }
    for (const col of settings.columns) {
      if (col.type === 'computed') continue;
      const names = [norm(col.label), norm(col.key), ...(SYNONYMS[col.key] || []).map(norm)];
      let score = 0;
      for (const n of names) {
        if (!n) continue;
        if (nh === n) score = Math.max(score, 100);
        else if (new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(nh)) score = Math.max(score, 60 + Math.min(30, n.length));
        else if (n.length > 4 && nh.includes(n)) score = Math.max(score, 55);
      }
      if (score >= 55) candidates.push({ i, key: col.key, score });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  const mapping = headers.map((h, i) => (norm(h) && !skip.has(i) ? '__new__' : ''));
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
        m = { id: slugKey(name, [...s.team, ...newMembers].map((t) => t.id)), name, email: /@/.test(name) ? name : '', initials: '', color: SWATCHES[(s.team.length + newMembers.length) % 8], role: 'Contract Manager' };
        newMembers.push(m);
      }
      return m.id;
    }
    const list = s.lists[listKey] || (s.lists[listKey] = []);
    if (!list.some((o) => norm(o.value) === norm(value))) {
      list.push({ value: String(value).trim(), color: SWATCHES[list.length % 8], ...(listKey === 'statut' ? { stage: 'active', progress: 50, dateField: '' } : {}) });
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
      const v = coerceValue(sWithMembers(), col, raw instanceof Date ? raw : typeof raw === 'number' && col.type === 'date' ? raw : typeof raw === 'number' || typeof raw === 'boolean' ? raw : String(raw), { addMissing });
      if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) values[key] = v;
    });
    if (isEmpty(values.client)) { skipped++; continue; }
    out.push(values);
  }
  s.team = [...s.team, ...newMembers];
  return { settings: s, rows: out, newColumns, addedValues, newMembers, skipped };
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

export async function exportWorkbook({ settings, contracts, derived, history = [], filtersLabel = '', today = todayISO() }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suivi de la saison contractuelle';
  wb.created = new Date();
  const s = settings;
  const cols = s.columns;

  /* Plages des listes déroulantes (la feuille « Listes » est écrite en dernier). */
  const listKeys = Object.keys(s.lists || {});
  const listRange = {};
  listKeys.forEach((k, i) => {
    const n = listOptions(s, k).length;
    if (n) listRange[k] = `Listes!$${colLetter(i + 1)}$2:$${colLetter(i + 1)}$${n + 1}`;
  });
  const teamCol = listKeys.length + 1;
  const teamRange = (s.team || []).length ? `Listes!$${colLetter(teamCol)}$2:$${colLetter(teamCol)}$${s.team.length + 1}` : null;

  /* Feuille Suivi. */
  const ws = wb.addWorksheet('Suivi', { properties: { tabColor: { argb: BLUE } }, views: [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }] });

  const HEADER_ROW = 4;
  ws.getCell('A1').value = s.season.name;
  ws.getCell('A1').font = { bold: true, size: 18, color: { argb: BLUE } };
  ws.getCell('A2').value = `${s.season.entity || ''}${s.season.entity ? ' · ' : ''}Export du ${fmtDateTime(Date.now())} · ${contracts.length} contrat(s)${filtersLabel ? ` · ${filtersLabel}` : ''}`;
  ws.getCell('A2').font = { size: 10, color: { argb: 'FF5B5F68' } };
  ws.getRow(1).height = 28;

  const header = ws.getRow(HEADER_ROW);
  cols.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = { right: { style: 'thin', color: { argb: 'FF2E44B8' } } };
    ws.getColumn(i + 1).width = Math.max(10, Math.round((col.width || 140) / 7.2));
  });
  header.height = 34;

  contracts.forEach((c, r) => {
    const row = ws.getRow(HEADER_ROW + 1 + r);
    const d = derived.get(c.id);
    cols.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      const v = c.values[col.key];
      if (col.type === 'date') { cell.value = isoToExcelDate(v); cell.numFmt = 'dd/mm/yyyy'; } else if (col.type === 'number') { cell.value = isEmpty(v) ? null : Number(v); cell.numFmt = Number.isInteger(Number(v)) ? '#,##0' : '#,##0.0#'; } else if (col.type === 'checkbox') cell.value = v ? 'Oui' : '';
      else if (col.type === 'computed' && col.computed === 'progress') { cell.value = d?.progress === null || d?.progress === undefined ? null : d.progress / 100; cell.numFmt = '0%'; } else if (col.type === 'url' && !isEmpty(v)) cell.value = { text: String(v), hyperlink: String(v) };
      else cell.value = displayValue(s, c, col, d) || null;
      cell.alignment = { vertical: 'top', wrapText: col.type === 'longtext' || (col.type === 'computed' && col.computed === 'alerts') };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9DBE1' } } };
      if (col.type === 'select' && !isEmpty(v)) {
        const color = listOptions(s, col.list).find((o) => o.value === v)?.color;
        if (color) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(color, 0.8) } };
      }
      if (col.key === 'client') cell.font = { bold: true };
      if (col.type === 'url' && !isEmpty(v)) cell.font = { color: { argb: BLUE }, underline: true };
    });
  });
  const lastRow = HEADER_ROW + Math.max(1, contracts.length);
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: cols.length } };

  // Listes déroulantes et mises en forme conditionnelles, comme dans le fichier d'origine.
  cols.forEach((col, i) => {
    const L = colLetter(i + 1);
    const ref = `${L}${HEADER_ROW + 1}:${L}${lastRow + 200}`;
    if (col.type === 'select' && listRange[col.list]) {
      ws.dataValidations.add(ref, { type: 'list', allowBlank: true, formulae: [listRange[col.list]], showErrorMessage: false });
    }
    if (col.type === 'person' && teamRange) ws.dataValidations.add(ref, { type: 'list', allowBlank: true, formulae: [teamRange], showErrorMessage: false });
    if (col.type === 'date') ws.dataValidations.add(ref, { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, errorTitle: 'Date invalide', error: 'Saisissez une date (jj/mm/aaaa).' });
  });
  const statusIdx = cols.findIndex((c) => c.key === 'statut');
  const doneValues = listOptions(s, 'statut').filter((o) => o.stage === 'done' || o.stage === 'cancelled').map((o) => o.value);
  const echIdx = cols.findIndex((c) => c.key === 'echeance');
  if (echIdx >= 0 && statusIdx >= 0) {
    const E = colLetter(echIdx + 1); const S = colLetter(statusIdx + 1);
    const notDone = doneValues.map((v) => `$${S}${HEADER_ROW + 1}<>"${v.replace(/"/g, '""')}"`).join(',');
    ws.addConditionalFormatting({
      ref: `${E}${HEADER_ROW + 1}:${E}${lastRow + 200}`,
      rules: [
        { type: 'expression', priority: 1, formulae: [`AND($${E}${HEADER_ROW + 1}<>"",$${E}${HEADER_ROW + 1}<TODAY()${notDone ? `,${notDone}` : ''})`], style: { font: { color: { argb: 'FFD03B3B' }, bold: true }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFBE3E3' } } } },
        { type: 'expression', priority: 2, formulae: [`AND($${E}${HEADER_ROW + 1}<>"",$${E}${HEADER_ROW + 1}-TODAY()<=${s.alerts?.dueSoonDays ?? 7}${notDone ? `,${notDone}` : ''})`], style: { font: { color: { argb: 'FFB86E00' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFF4DC' } } } },
      ],
    });
  }
  const cgvIdx = cols.findIndex((c) => c.key === 'dateCgv');
  const cgvMs = milestoneByRole(s, 'cgv');
  if (cgvIdx >= 0 && statusIdx >= 0 && cgvMs) {
    const C = colLetter(cgvIdx + 1); const S = colLetter(statusIdx + 1);
    ws.addConditionalFormatting({
      ref: `${C}${HEADER_ROW + 1}:${C}${lastRow + 200}`,
      rules: [{ type: 'expression', priority: 3, formulae: [`AND($${C}${HEADER_ROW + 1}="",$A${HEADER_ROW + 1}<>"",TODAY()>DATE(${cgvMs.date.slice(0, 4)},${Number(cgvMs.date.slice(5, 7))},${Number(cgvMs.date.slice(8, 10))})${doneValues.length ? `,${doneValues.map((v) => `$${S}${HEADER_ROW + 1}<>"${v.replace(/"/g, '""')}"`).join(',')}` : ''})`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFBE3E3' } } } }],
    });
  }

  /* Feuille Tableau de bord. */
  const wsD = wb.addWorksheet('Tableau de bord', { properties: { tabColor: { argb: 'FF0CA30C' } }, views: [{ showGridLines: false }] });
  const k = kpis(s, contracts, derived, today);
  wsD.getColumn(1).width = 42; wsD.getColumn(2).width = 16; wsD.getColumn(3).width = 16; wsD.getColumn(4).width = 16; wsD.getColumn(5).width = 16; wsD.getColumn(6).width = 16;
  wsD.getCell('A1').value = `${s.season.name} — tableau de bord`;
  wsD.getCell('A1').font = { bold: true, size: 16, color: { argb: BLUE } };
  wsD.getCell('A2').value = `Situation au ${fmtDate(today, 'long')}`;
  wsD.getCell('A2').font = { color: { argb: 'FF5B5F68' } };
  const sig = k.signatureMilestone;
  const kpiRows = [
    ['Contrats suivis (hors abandonnés)', k.live],
    ['Conventions signées', k.signed, k.signedPct],
    ['CGV envoyées', k.cgvSent, k.cgvPct],
    ['En cours de négociation', k.active],
    ['À lancer', k.todo],
    ['Bloqués / escalade', k.blocked],
    ['Contrats avec alerte critique', k.critical],
    ['Actions en retard', k.overdueActions],
    ['CA N-1 total (k€)', Math.round(k.caTotal)],
    ['CA N-1 signé (k€)', Math.round(k.caSigned), k.caSignedPct],
    ...(sig ? [[`Jours avant ${sig.label.toLowerCase()} (${fmtDate(sig.date)})`, k.daysToSignature]] : []),
  ];
  sectionTitle(wsD, 4, 'Indicateurs clés');
  kpiRows.forEach((r, i) => {
    const row = wsD.getRow(5 + i);
    row.getCell(1).value = r[0];
    row.getCell(2).value = r[1];
    if (r[2] !== undefined) { row.getCell(3).value = r[2]; row.getCell(3).numFmt = '0%'; }
    row.getCell(2).font = { bold: true };
    row.eachCell((c) => { c.border = { bottom: { style: 'hair', color: { argb: 'FFD9DBE1' } } }; });
  });
  let line = 6 + kpiRows.length;
  sectionTitle(wsD, line, 'Répartition par statut');
  tableHeader(wsD, line + 1, ['Statut', 'Contrats', 'CA N-1 (k€)']);
  const st = byStatus(s, contracts);
  st.forEach((r, i) => {
    const row = wsD.getRow(line + 2 + i);
    row.getCell(1).value = r.value; row.getCell(2).value = r.count; row.getCell(3).value = Math.round(r.ca);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(r.color, 0.8) } };
  });
  line += 3 + st.length;
  const cmCol = columnByKey(s, 'cm');
  if (cmCol) {
    sectionTitle(wsD, line, 'Avancement par contract manager');
    tableHeader(wsD, line + 1, ['Contract manager', 'Signés', 'En cours', 'À lancer', 'Bloqués', 'Total']);
    const groups = breakdown(s, contracts, derived, 'cm');
    groups.forEach((g, i) => {
      const row = wsD.getRow(line + 2 + i);
      row.values = [g.label, g.counts.done, g.counts.active, g.counts.todo, g.counts.blocked, g.total];
    });
    line += 3 + groups.length;
  }
  sectionTitle(wsD, line, 'Jalons de la saison');
  tableHeader(wsD, line + 1, ['Jalon', 'Date', 'Note']);
  (s.milestones || []).forEach((m, i) => {
    const row = wsD.getRow(line + 2 + i);
    row.getCell(1).value = m.label; row.getCell(2).value = isoToExcelDate(m.date); row.getCell(2).numFmt = 'dd/mm/yyyy'; row.getCell(3).value = m.note || '';
  });

  /* Feuille Journal. */
  const wsH = wb.addWorksheet('Journal', { properties: { tabColor: { argb: 'FFEB6834' } }, views: [{ state: 'frozen', ySplit: 1 }] });
  const hHead = ['Date et heure', 'Utilisateur', 'Réf.', 'Contrat', 'Action', 'Champ', 'Ancienne valeur', 'Nouvelle valeur'];
  tableHeader(wsH, 1, hHead);
  [18, 22, 11, 28, 14, 22, 34, 34].forEach((w, i) => { wsH.getColumn(i + 1).width = w; });
  const ACTIONS = { update: 'Modification', create: 'Création', delete: 'Suppression', restore: 'Restauration', comment: 'Commentaire', mail: 'Relance', import: 'Import', settings: 'Paramètres', 'restore-all': 'Données' };
  history.slice(0, 5000).forEach((h, i) => {
    wsH.getRow(2 + i).values = [fmtDateTime(h.ts), h.user || '', h.contractRef || '', h.contractLabel || '', ACTIONS[h.action] || h.action, h.fieldLabel || '', h.from || '', h.to || ''];
  });
  wsH.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hHead.length } };

  /* Feuille Listes (source des listes déroulantes). */
  const wsL = wb.addWorksheet('Listes', { properties: { tabColor: { argb: 'FF9A9DA5' } } });
  listKeys.forEach((k, i) => {
    const c = i + 1;
    const head = wsL.getCell(1, c);
    head.value = s.listLabels?.[k] || k;
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    const opts = listOptions(s, k);
    opts.forEach((o, j) => { const cell = wsL.getCell(j + 2, c); cell.value = o.value; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tint(o.color) } }; });
    wsL.getColumn(c).width = Math.max(18, ...opts.map((o) => o.value.length + 2));
  });
  const th = wsL.getCell(1, teamCol);
  th.value = 'Équipe';
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
