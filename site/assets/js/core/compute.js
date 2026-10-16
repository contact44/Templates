// Calculs métier : étape et avancement d'un contrat, alertes, indicateurs, répartitions,
// courbe de signatures, agenda des échéances, valeurs affichées, tri et filtres.

import { columnByKey, listOptions, memberById, milestoneByRole, STAGES } from './schema.js';
import {
  addDays, diffDays, fmtDate, fmtDateTime, fmtNumber, isEmpty, norm, parseDateInput as parseDateLoose,
  startOfWeek, todayISO,
} from './utils.js';

export const LEVEL_RANK = { critical: 3, serious: 2, warning: 1, info: 0 };
export const LEVEL_LABEL = { critical: 'Critique', serious: 'Important', warning: 'À surveiller', info: 'Information' };

export function statusOption(settings, value) {
  if (isEmpty(value)) return null;
  return listOptions(settings, 'statut').find((o) => o.value === value) || null;
}

export function stageOf(settings, contract) {
  const opt = statusOption(settings, contract.values.statut);
  return opt ? opt.stage || 'active' : 'todo';
}

/** Avancement en % (null pour un statut sans avancement propre : bloqué, abandonné). */
export function progressOf(settings, contract) {
  const opt = statusOption(settings, contract.values.statut);
  if (!opt) return 0;
  if (opt.stage === 'done') return 100;
  if (typeof opt.progress === 'number') return opt.progress;
  return null;
}

/** Alertes d'un contrat, de la plus grave à la moins grave. */
export function alertsOf(settings, contract, today = todayISO()) {
  const out = [];
  const stage = stageOf(settings, contract);
  if (stage === 'done' || stage === 'cancelled') return out;
  const v = contract.values;
  const cfg = settings.alerts || {};
  const cgv = milestoneByRole(settings, 'cgv');
  const sig = milestoneByRole(settings, 'signature');
  const target = milestoneByRole(settings, 'target');

  if (stage === 'blocked') {
    out.push({ code: 'blocked', level: 'critical', label: v.blocage ? `Bloqué : ${v.blocage}` : 'Négociation bloquée ou en escalade' });
  }
  if (cgv) {
    if (isEmpty(v.dateCgv)) {
      const d = diffDays(today, cgv.date);
      if (d < 0) out.push({ code: 'cgvLate', level: 'critical', label: `CGV non envoyées : échéance du ${fmtDate(cgv.date, 'dm')} dépassée de ${-d} j` });
      else if (d <= (cfg.cgvWarnDays ?? 21)) out.push({ code: 'cgvSoon', level: 'warning', label: `CGV à envoyer avant le ${fmtDate(cgv.date, 'dm')} (J-${d})` });
    } else if (v.dateCgv > cgv.date) {
      out.push({ code: 'cgvLateSent', level: 'info', label: `CGV envoyées après l'échéance du ${fmtDate(cgv.date, 'dm')}` });
    }
  }
  if (sig) {
    const d = diffDays(today, sig.date);
    const p = progressOf(settings, contract) ?? 0;
    if (d < 0) {
      out.push({ code: 'sigLate', level: 'critical', label: `Non signé à la date butoir du ${fmtDate(sig.date, 'dm')}` });
    } else if (target && today > target.date) {
      out.push({ code: 'targetMissed', level: 'serious', label: `Objectif interne du ${fmtDate(target.date, 'dm')} dépassé, date butoir J-${d}` });
    } else if (d <= (cfg.deadlineWarnDays ?? 30)) {
      if (p < (cfg.deadlineRiskProgress ?? 55)) out.push({ code: 'sigRisk', level: 'serious', label: `Risque sur la date butoir (J-${d}) : avancement ${p} %` });
      else out.push({ code: 'sigSoon', level: 'warning', label: `Signature attendue avant le ${fmtDate(sig.date, 'dm')} (J-${d})` });
    }
  }
  if (!isEmpty(v.echeance)) {
    const d = diffDays(today, v.echeance);
    const what = v.prochaineAction ? ` : ${v.prochaineAction}` : '';
    if (d < 0) out.push({ code: 'actionLate', level: 'serious', label: `Action en retard de ${-d} j${what}` });
    else if (d === 0) out.push({ code: 'actionSoon', level: 'warning', label: `Action à faire aujourd'hui${what}` });
    else if (d <= (cfg.dueSoonDays ?? 7)) out.push({ code: 'actionSoon', level: 'warning', label: `Action à échéance dans ${d} j${what}` });
  } else if (stage !== 'todo' && isEmpty(v.prochaineAction)) {
    out.push({ code: 'noAction', level: 'info', label: 'Aucune prochaine action planifiée' });
  }
  if (isEmpty(v.cm)) out.push({ code: 'noCm', level: 'info', label: 'Aucun contract manager assigné' });
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}

/** Étape, avancement et alertes de chaque contrat. */
export function deriveAll(settings, contracts, today = todayISO()) {
  const map = new Map();
  for (const c of contracts) {
    const alerts = alertsOf(settings, c, today);
    map.set(c.id, {
      stage: stageOf(settings, c),
      progress: progressOf(settings, c),
      alerts,
      level: alerts.length ? alerts[0].level : null,
    });
  }
  return map;
}

const sum = (arr, fn) => arr.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0);

export function kpis(settings, contracts, derived, today = todayISO()) {
  const live = contracts.filter((c) => derived.get(c.id)?.stage !== 'cancelled');
  const by = (stage) => live.filter((c) => derived.get(c.id).stage === stage);
  const signed = by('done');
  const cgvSent = live.filter((c) => !isEmpty(c.values.dateCgv) || derived.get(c.id).stage === 'done');
  const withAlert = (lvl) => live.filter((c) => derived.get(c.id).alerts.some((a) => a.level === lvl));
  const sig = milestoneByRole(settings, 'signature');
  const cgv = milestoneByRole(settings, 'cgv');
  const target = milestoneByRole(settings, 'target');
  const progressValues = live.map((c) => derived.get(c.id).progress ?? 0);
  const caTotal = sum(live, (c) => c.values.ca);
  const caSigned = sum(signed, (c) => c.values.ca);
  return {
    total: contracts.length,
    live: live.length,
    cancelled: contracts.length - live.length,
    signed: signed.length,
    active: by('active').length,
    todo: by('todo').length,
    blocked: by('blocked').length,
    signedPct: live.length ? signed.length / live.length : 0,
    caTotal,
    caSigned,
    caSignedPct: caTotal ? caSigned / caTotal : 0,
    cgvSent: cgvSent.length,
    cgvPct: live.length ? cgvSent.length / live.length : 0,
    critical: withAlert('critical').length,
    serious: withAlert('serious').length,
    overdueActions: live.filter((c) => derived.get(c.id).alerts.some((a) => a.code === 'actionLate')).length,
    dueSoon: live.filter((c) => derived.get(c.id).alerts.some((a) => a.code === 'actionSoon')).length,
    avgProgress: progressValues.length ? sum(progressValues, (x) => x) / progressValues.length : 0,
    daysToSignature: sig ? diffDays(today, sig.date) : null,
    daysToCgv: cgv ? diffDays(today, cgv.date) : null,
    daysToTarget: target ? diffDays(today, target.date) : null,
    signatureMilestone: sig,
    cgvMilestone: cgv,
    targetMilestone: target,
  };
}

/** Nombre de contrats et CA par valeur de statut, dans l'ordre de la liste. */
export function byStatus(settings, contracts) {
  const rows = listOptions(settings, 'statut').map((o) => ({ ...o, count: 0, ca: 0 }));
  let none = null;
  for (const c of contracts) {
    const row = rows.find((r) => r.value === c.values.statut);
    if (row) { row.count++; row.ca += Number(c.values.ca) || 0; } else {
      none = none || { value: 'Sans statut', color: '#a3a7af', stage: 'todo', count: 0, ca: 0, empty: true };
      none.count++; none.ca += Number(c.values.ca) || 0;
    }
  }
  return none ? [none, ...rows] : rows;
}

/** Répartition par étape (signé / en cours / à lancer / bloqué) selon une dimension. */
export function breakdown(settings, contracts, derived, dimKey) {
  const col = columnByKey(settings, dimKey);
  if (!col) return [];
  const groups = new Map();
  const ensure = (key, label, color, order) => {
    if (!groups.has(key)) groups.set(key, { key, label, color, order, counts: { todo: 0, active: 0, blocked: 0, done: 0 }, total: 0, ca: 0 });
    return groups.get(key);
  };
  if (col.type === 'person') {
    (settings.team || []).forEach((m, i) => ensure(m.id, m.name, m.color, i));
  } else if (col.type === 'select' || col.type === 'multiselect') {
    listOptions(settings, col.list).forEach((o, i) => ensure(o.value, o.value, o.color, i));
  }
  for (const c of contracts) {
    const d = derived.get(c.id);
    if (!d || d.stage === 'cancelled') continue;
    const raw = c.values[dimKey];
    let keys = Array.isArray(raw) ? raw : isEmpty(raw) ? [] : [raw];
    if (!keys.length) keys = ['__empty__'];
    for (const k of keys) {
      let label = k;
      if (k === '__empty__') label = col.type === 'person' ? 'Non assigné' : 'Non renseigné';
      else if (col.type === 'person') label = memberById(settings, k)?.name || k;
      const g = ensure(k, label, '#a3a7af', k === '__empty__' ? 9999 : 5000);
      g.counts[d.stage] = (g.counts[d.stage] || 0) + 1;
      g.total++;
      g.ca += Number(c.values.ca) || 0;
    }
  }
  return [...groups.values()].filter((g) => g.total > 0 || g.order < 5000).sort((a, b) => a.order - b.order);
}

/** Signatures cumulées dans le temps et trajectoire cible jusqu'à la date butoir. */
export function signatureSeries(settings, contracts, derived, today = todayISO()) {
  const live = contracts.filter((c) => derived.get(c.id)?.stage !== 'cancelled');
  const sig = milestoneByRole(settings, 'signature');
  const cgv = milestoneByRole(settings, 'cgv');
  const firstMs = (settings.milestones || []).map((m) => m.date).filter(Boolean).sort()[0];
  const signedDates = live.filter((c) => derived.get(c.id).stage === 'done').map((c) => c.values.dateSignature).filter(Boolean).sort();
  const undated = live.filter((c) => derived.get(c.id).stage === 'done' && !c.values.dateSignature).length;
  const start = [firstMs, signedDates[0], today].filter(Boolean).sort()[0];
  const end = [sig?.date, today, signedDates[signedDates.length - 1]].filter(Boolean).sort().reverse()[0];
  const points = [];
  let cum = 0; let i = 0;
  const last = today < end ? today : end;
  for (let d = start; d <= last; d = addDays(d, 1)) {
    while (i < signedDates.length && signedDates[i] <= d) { cum++; i++; }
    points.push({ date: d, value: cum });
  }
  const targetStart = cgv?.date && cgv.date < (sig?.date || end) ? cgv.date : start;
  const target = sig ? [{ date: targetStart, value: 0 }, { date: sig.date, value: live.length }] : [];
  return { start, end, points, target, total: live.length, undated };
}

/** Actions à venir regroupées : en retard, cette semaine, semaine prochaine, plus tard. */
export function agenda(settings, contracts, derived, today = todayISO()) {
  const thisWeek = startOfWeek(today);
  const nextWeek = addDays(thisWeek, 7);
  const after = addDays(thisWeek, 14);
  const buckets = { overdue: [], week: [], next: [], later: [] };
  let undated = 0;
  for (const c of contracts) {
    const d = derived.get(c.id);
    if (!d || d.stage === 'done' || d.stage === 'cancelled') continue;
    const due = c.values.echeance;
    if (isEmpty(due)) { if (d.stage !== 'todo') undated++; continue; }
    const item = { contract: c, date: due, days: diffDays(today, due) };
    if (due < today) buckets.overdue.push(item);
    else if (due < nextWeek) buckets.week.push(item);
    else if (due < after) buckets.next.push(item);
    else buckets.later.push(item);
  }
  for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...buckets, undated };
}

/* --------------------------------------------------- Valeurs et affichage */

export function personName(settings, id) {
  if (isEmpty(id)) return '';
  return memberById(settings, id)?.name || String(id);
}

export function displayValue(settings, contract, col, derivedEntry) {
  const v = contract.values[col.key];
  switch (col.type) {
    case 'date': return fmtDate(v);
    case 'number': return v === null || v === undefined || v === '' ? '' : fmtNumber(v, 2);
    case 'multiselect': return Array.isArray(v) ? v.join(', ') : (v ?? '');
    case 'person': return personName(settings, v);
    case 'checkbox': return v ? 'Oui' : '';
    case 'computed': {
      if (col.computed === 'progress') {
        const p = derivedEntry ? derivedEntry.progress : progressOf(settings, contract);
        return p === null || p === undefined ? '' : `${p} %`;
      }
      if (col.computed === 'alerts') {
        const alerts = derivedEntry ? derivedEntry.alerts : alertsOf(settings, contract);
        return alerts.map((a) => a.label).join(' ; ');
      }
      if (col.computed === 'updated') {
        return contract.updatedAt ? `${fmtDateTime(contract.updatedAt)}${contract.updatedByName ? ` – ${contract.updatedByName}` : ''}` : '';
      }
      return '';
    }
    default: return v === null || v === undefined ? '' : String(v);
  }
}

export function sortValue(settings, contract, col, derivedEntry) {
  const v = contract.values[col.key];
  switch (col.type) {
    case 'select': {
      if (isEmpty(v)) return null;
      const idx = listOptions(settings, col.list).findIndex((o) => o.value === v);
      return idx < 0 ? 1000 + norm(v).charCodeAt(0) : idx;
    }
    case 'multiselect': {
      if (!Array.isArray(v) || !v.length) return null;
      const opts = listOptions(settings, col.list);
      return Math.min(...v.map((x) => { const i = opts.findIndex((o) => o.value === x); return i < 0 ? 999 : i; }));
    }
    case 'number': return v === null || v === undefined || v === '' ? null : Number(v);
    case 'date': return isEmpty(v) ? null : v;
    case 'person': return isEmpty(v) ? null : norm(personName(settings, v));
    case 'checkbox': return v ? 1 : 0;
    case 'computed': {
      if (col.computed === 'progress') return derivedEntry?.progress ?? null;
      if (col.computed === 'alerts') {
        const a = derivedEntry?.alerts || [];
        return a.length ? LEVEL_RANK[a[0].level] * 100 + a.length : null;
      }
      if (col.computed === 'updated') return contract.updatedAt || null;
      return null;
    }
    default: {
      if (isEmpty(v)) return null;
      if (col.key === 'ref') {
        const n = String(v).match(/(\d+)\s*$/);
        return n ? Number(n[1]) : norm(v);
      }
      return norm(v);
    }
  }
}

/** Compare deux valeurs de tri ; les cellules vides restent toujours en bas. */
export function compareSortValues(a, b, dir = 1) {
  const ea = a === null || a === undefined; const eb = b === null || b === undefined;
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
  return String(a).localeCompare(String(b), 'fr', { numeric: true }) * dir;
}

export function searchText(settings, contract) {
  return norm(settings.columns.filter((c) => c.type !== 'computed').map((col) => displayValue(settings, contract, col)).join(' | '));
}

/**
 * Filtres communs aux vues : recherche, valeurs par champ, raccourcis.
 * filters = { search, fields: { cle: [valeurs] }, quick }
 */
export function matchFilters(settings, contract, derivedEntry, filters, ctx = {}) {
  if (!filters) return true;
  if (filters.search) {
    const terms = norm(filters.search).split(' ').filter(Boolean);
    const text = searchText(settings, contract);
    if (!terms.every((t) => text.includes(t))) return false;
  }
  for (const [key, wanted] of Object.entries(filters.fields || {})) {
    if (!wanted || !wanted.length) continue;
    const raw = contract.values[key];
    const values = Array.isArray(raw) ? raw : isEmpty(raw) ? [] : [raw];
    if (!values.length) { if (!wanted.includes('__empty__')) return false; } else if (!values.some((x) => wanted.includes(x))) return false;
  }
  const d = derivedEntry || { stage: stageOf(settings, contract), alerts: [] };
  switch (filters.quick) {
    case 'mine': return !!ctx.meId && contract.values.cm === ctx.meId;
    case 'alerts': return d.alerts.some((a) => a.level === 'critical' || a.level === 'serious');
    case 'late': return d.alerts.some((a) => a.code === 'actionLate' || a.code === 'cgvLate' || a.code === 'sigLate');
    case 'blocked': return d.stage === 'blocked';
    case 'active': return d.stage === 'active';
    case 'todo': return d.stage === 'todo';
    case 'signed': return d.stage === 'done';
    case 'cgv': return isEmpty(contract.values.dateCgv) && d.stage !== 'done' && d.stage !== 'cancelled';
    default: return true;
  }
}

export const QUICK_VIEWS = [
  { id: '', label: 'Tous' },
  { id: 'mine', label: 'Mes contrats' },
  { id: 'alerts', label: 'Alertes' },
  { id: 'late', label: 'En retard' },
  { id: 'cgv', label: 'CGV à envoyer' },
  { id: 'blocked', label: 'Bloqués' },
  { id: 'signed', label: 'Signés' },
];

export function stageLabel(id) { return STAGES.find((s) => s.id === id)?.label || id; }

/** Conversion d'une saisie texte (collage, import) vers la valeur typée d'une colonne. */
export function coerceValue(settings, col, raw, { addMissing } = {}) {
  if (raw === undefined) return undefined;
  if (col.type === 'computed') return undefined;
  const text = raw instanceof Date ? raw : typeof raw === 'string' ? raw.trim() : raw;
  if (text === '' || text === null) return col.type === 'multiselect' ? [] : col.type === 'checkbox' ? false : null;
  return coerceNonEmpty(settings, col, text, addMissing);
}

function coerceNonEmpty(settings, col, text, addMissing) {
  switch (col.type) {
    case 'number': {
      if (typeof text === 'number') return text;
      const s = String(text).replace(/[\s  ]|k€|€/gi, '').replace(',', '.');
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    case 'date': return parseDateLoose(text);
    case 'checkbox': return ['oui', 'yes', 'x', 'vrai', 'true', '1', '✓', 'ok'].includes(norm(text));
    case 'select': return matchOption(settings, col.list, String(text), addMissing);
    case 'multiselect': return [...new Set(String(text).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
      .map((s) => matchOption(settings, col.list, s, addMissing)).filter(Boolean))];
    case 'person': return matchMember(settings, String(text), addMissing);
    default: return String(text instanceof Date ? fmtDate(parseDateLoose(text)) : text);
  }
}

function matchOption(settings, listKey, text, addMissing) {
  const list = listOptions(settings, listKey);
  const n = norm(text);
  const exact = list.find((o) => norm(o.value) === n);
  if (exact) return exact.value;
  const partial = list.find((o) => norm(o.value).startsWith(n) || n.startsWith(norm(o.value)));
  if (partial && n.length >= 3) return partial.value;
  // « DA » → « Électroménager (DA) » : mot entier présent dans une seule valeur.
  const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
  const words = list.filter((o) => re.test(norm(o.value)));
  if (n.length >= 2 && words.length === 1) return words[0].value;
  if (addMissing) addMissing(listKey, text);
  return text;
}

function matchMember(settings, text, addMissing) {
  const n = norm(text);
  const m = (settings.team || []).find((t) => norm(t.name) === n || norm(t.email) === n || norm(t.initials) === n || norm(t.id) === n)
    || (settings.team || []).find((t) => n.length >= 3 && (norm(t.name).startsWith(n) || norm(t.name).split(' ').includes(n)));
  if (m) return m.id;
  if (addMissing) return addMissing('__team__', text);
  return null;
}
