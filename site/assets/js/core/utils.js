// Fonctions utilitaires partagées : échappement, dates, nombres, stockage, presse-papiers.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Échappe une valeur pour l'insérer dans du HTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function uid(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  (globalThis.crypto || {}).getRandomValues
    ? globalThis.crypto.getRandomValues(bytes)
    : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Forme normalisée d'un texte pour les comparaisons (sans accents, minuscules, espaces simples). */
export function norm(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’'`]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Clé technique sûre (ASCII, sans point) à partir d'un libellé. */
export function slugKey(label, taken = []) {
  const base = norm(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'champ';
  let key = /^[a-z]/.test(base) ? base : `c_${base}`;
  let i = 2;
  while (taken.includes(key)) key = `${base}_${i++}`;
  return key;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/[\s.\-_@]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ------------------------------------------------------------------ Dates */
// Les dates métier sont stockées en ISO « AAAA-MM-JJ » (sans fuseau) ; les calculs se font en UTC.

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const WEEKDAYS_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

let todayOverride = null;
/** Permet de figer « aujourd'hui » (tests, aperçu). */
export function setToday(iso) { todayOverride = iso || null; }

export function todayISO() {
  if (todayOverride) return todayOverride;
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function isISODate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function isoToUTC(iso) {
  if (!isISODate(iso)) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcToISO(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Nombre de jours de a vers b (b - a). */
export function diffDays(a, b) {
  const ta = isoToUTC(a); const tb = isoToUTC(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return NaN;
  return Math.round((tb - ta) / 86400000);
}

export function addDays(iso, n) {
  const t = isoToUTC(iso);
  if (Number.isNaN(t)) return iso;
  return utcToISO(t + n * 86400000);
}

export function weekday(iso) { return new Date(isoToUTC(iso)).getUTCDay(); }

/** Lundi de la semaine contenant la date. */
export function startOfWeek(iso) {
  const wd = weekday(iso);
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

export function fmtDate(iso, style = 'short') {
  if (!isISODate(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  switch (style) {
    case 'medium': return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
    case 'long': return `${d === 1 ? '1er' : d} ${MONTHS_LONG[m - 1]} ${y}`;
    case 'dm': return `${d} ${MONTHS_SHORT[m - 1]}`;
    case 'month': return `${MONTHS_LONG[m - 1]} ${y}`;
    case 'monthShort': return `${MONTHS_SHORT[m - 1]}`;
    case 'weekday': return `${WEEKDAYS_SHORT[weekday(iso)]} ${d} ${MONTHS_SHORT[m - 1]}`;
    default: return `${pad2(d)}/${pad2(m)}/${y}`;
  }
}

export function fmtDateTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtRelative(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  return fmtDateTime(ms).slice(0, 10);
}

/** « J-12 », « J+3 », « Aujourd'hui ». n = date - aujourd'hui. */
export function fmtCountdown(n) {
  if (Number.isNaN(n)) return '';
  if (n === 0) return "Aujourd'hui";
  return n > 0 ? `J-${n}` : `J+${-n}`;
}

/**
 * Interprète une date saisie ou importée : objet Date, numéro de série Excel,
 * « 01/12/2026 », « 1/12/26 », « 2026-12-01 », « 01.12.2026 », « 1 décembre 2026 ».
 * Retourne une date ISO ou null.
 */
export function parseDateInput(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const t = norm(value);
    const today = todayISO();
    if (t === "aujourd'hui" || t === 'auj' || t === 'today') return today;
    if (t === 'demain') return addDays(today, 1);
    if (t === 'hier') return addDays(today, -1);
    const rel = t.match(/^(?:j)?\s*([+-])\s*(\d{1,3})\s*(j|s|sem)?$/);
    if (rel) return addDays(today, (rel[1] === '-' ? -1 : 1) * Number(rel[2]) * (rel[3] && rel[3] !== 'j' ? 7 : 1));
    const dm = t.match(/^(\d{1,2})[/.\-](\d{1,2})$/);
    if (dm) {
      // Jour/mois sans année : on retient l'occurrence la plus proche d'aujourd'hui.
      const y = Number(today.slice(0, 4));
      const cands = [y - 1, y, y + 1].map((yy) => validYMD(yy, +dm[2], +dm[1])).filter(Boolean);
      cands.sort((a, b) => Math.abs(diffDays(today, a)) - Math.abs(diffDays(today, b)));
      return cands[0] || null;
    }
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // ExcelJS fournit des dates à minuit UTC.
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;
  }
  if (typeof value === 'number') {
    if (value > 20000 && value < 90000) return utcToISO(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return validYMD(y, +m[2], +m[1]);
  }
  m = norm(s).match(/^(\d{1,2})(?:er)?\s+([a-z.]+)\s+(\d{4})$/);
  if (m) {
    const mon = norm(m[2]).replace('.', '');
    const idx = MONTHS_LONG.findIndex((x) => norm(x).startsWith(mon.slice(0, 3)));
    if (idx >= 0) return validYMD(+m[3], idx + 1, +m[1]);
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDateInput(Number(s));
  return null;
}

function validYMD(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  return utcToISO(isoToUTC(iso)) === iso ? iso : null;
}

/* ---------------------------------------------------------------- Nombres */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function fmtNumber(n, decimals = 0) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  return (decimals === 0 ? nf0 : decimals === 1 ? nf1 : nf2).format(v);
}

/** Montant exprimé en k€ : « 850 k€ », « 12,4 M€ ». */
export function fmtMoneyK(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  if (Math.abs(v) >= 1000) return `${nf1.format(v / 1000)} M€`;
  return `${nf0.format(v)} k€`;
}

export function fmtPct(ratio) {
  if (!Number.isFinite(ratio)) return '–';
  return `${Math.round(ratio * 100)} %`;
}

export function parseNumberInput(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).replace(/\s| | |k€|€|eur/gi, '').replace(',', '.');
  if (!s) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------- Fonctions */

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function throttle(fn, ms) {
  let last = 0; let t;
  return (...args) => {
    const now = Date.now();
    const wait = ms - (now - last);
    clearTimeout(t);
    if (wait <= 0) { last = now; fn(...args); } else { t = setTimeout(() => { last = Date.now(); fn(...args); }, wait); }
  };
}

export function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

export function sameValue(a, b) {
  const ea = a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length);
  const eb = b === undefined || b === null || b === '' || (Array.isArray(b) && !b.length);
  if (ea && eb) return true;
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

export function isEmpty(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/* ------------------------------------------------------- Stockage local */

const memoryStore = new Map();
export const safeStorage = {
  get(key, fallback = null) {
    try {
      const raw = globalThis.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return memoryStore.has(key) ? deepClone(memoryStore.get(key)) : fallback;
    }
  },
  set(key, value) {
    try { globalThis.localStorage.setItem(key, JSON.stringify(value)); return true; } catch {
      memoryStore.set(key, deepClone(value)); return false;
    }
  },
  remove(key) {
    try { globalThis.localStorage.removeItem(key); } catch { /* indisponible */ }
    memoryStore.delete(key);
  },
};

/* --------------------------------------------- Fichiers et presse-papiers */

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Analyse un texte copié depuis Excel (tabulations, guillemets, retours à la ligne dans les cellules). */
export function parseTSV(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function toTSV(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join('\t')).join('\n');
}

/** CSV au format Excel français (séparateur « ; », BOM UTF-8). */
export function toCSV(rows) {
  const body = rows.map((r) => r.map((c) => {
    let s = String(c ?? '');
    // Neutralise les formules (=, +, @) pour qu'Excel ne les exécute pas à l'ouverture.
    if (typeof c === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  return `﻿${body}`;
}

export function pluralize(n, one, many) { return `${fmtNumber(n)} ${n > 1 ? many : one}`; }
