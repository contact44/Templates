// Calculs métier, transposés des formules du classeur « Suivi CM 2027 » :
// étape du dossier (REPORT PAR DIV, dont REPORT GEN est la synthèse), durées des jalons, jours au stade actuel, signature N-1 + 1 an, écart vs N-1,
// contrôle de l'ordre des jalons, reportings par statut et par division, charge de l'équipe,
// suivi hebdomadaire, valeurs affichées, tri, filtres et conversion des saisies.

import {
  accountRoleOf, CLIENT_FIELDS, columnByKey, listOptions, memberById, milestoneByRole, REPORT_STAGES, stageLabel, stepName,
} from './schema.js';
import {
  addDays, diffDays, fmtDate, fmtDateTime, fmtNumber, isEmpty, norm, parseDateInput as parseDateLoose, parseNumberInput,
  todayISO,
} from './utils.js';

export const LEVEL_RANK = { critical: 3, serious: 2, warning: 1, info: 0 };
export const LEVEL_LABEL = { critical: 'Critique', serious: 'Important', warning: 'À surveiller', info: 'Information' };

/** Jalons datés de la saison, dans l'ordre du processus (colonnes X à AG du classeur). */
export const JALONS = ['receptionCc', 'revueAttribuee', 'revueTerminee', 'approvalLancee', 'approvalTerminee', 'miseEnSignature', 'signatureClient', 'signatureSef'];

export function statusOption(settings, value, list = 'statut') {
  if (isEmpty(value)) return null;
  return listOptions(settings, list).find((o) => o.value === value) || null;
}

/**
 * Étape détaillée du dossier (index dans REPORT PAR DIV, -1 si non renseignée). À défaut d'étape DIV,
 * la première étape correspondant au REPORT GEN saisi (fichiers importés).
 */
export function stepIndex(settings, contract) {
  const steps = listOptions(settings, 'reportDiv');
  const v = contract.values;
  if (!isEmpty(v.reportDiv)) {
    const i = steps.findIndex((o) => o.value === v.reportDiv);
    if (i >= 0) return i;
  }
  if (!isEmpty(v.statut)) return steps.findIndex((o) => o.gen === v.statut);
  return -1;
}

/** REPORT GEN d'un dossier : déduit de l'étape DIV (sinon la valeur saisie). */
export function genOf(settings, contract) {
  const v = contract.values;
  if (!isEmpty(v.reportDiv)) {
    const o = listOptions(settings, 'reportDiv').find((x) => x.value === v.reportDiv);
    if (o?.gen) return o.gen;
  }
  return v.statut ?? null;
}

/** REPORT GEN correspondant à une étape DIV. */
export function genForStep(settings, divValue) {
  return listOptions(settings, 'reportDiv').find((o) => o.value === divValue)?.gen ?? null;
}

/** Phase de synthèse (todo / active / signature / done) d'une étape DIV : celle de son REPORT GEN. */
export function stepStage(settings, divOption) {
  if (!divOption) return 'none';
  return statusOption(settings, divOption.gen)?.stage || divOption.stage || 'active';
}

/** Étape de synthèse d'un compte d'après son REPORT GEN (none si vide ou inconnu). */
export function stageOf(settings, contract) {
  return statusOption(settings, genOf(settings, contract))?.stage || 'none';
}

/** Avancement : rang de l'étape DIV parmi les étapes jusqu'à la signature (100 % une fois signé). */
export function progressOf(settings, contract) {
  const steps = listOptions(settings, 'reportDiv');
  const i = stepIndex(settings, contract);
  if (i < 0) return 0;
  if (stepStage(settings, steps[i]) === 'done') return 100;
  const firstDone = steps.findIndex((o) => stepStage(settings, o) === 'done');
  const span = firstDone > 0 ? firstDone : steps.length;
  return Math.round((i / span) * 100);
}

/** EDATE d'Excel : même jour n mois plus tard, ramené au dernier jour du mois si besoin. */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const maxDate = (...dates) => dates.filter(Boolean).sort().pop() || null;
const days = (from, to) => (from && to ? diffDays(from, to) : null);

/** Calculs automatiques d'une ligne (colonnes « auto » du classeur). */
export function rowCalc(settings, contract, today = todayISO()) {
  const v = contract.values;
  const cfg = settings.alerts || {};
  const role = accountRoleOf(settings, v.statutCompte);
  const closed = role === 'ferme';
  const actif = role === 'actif';
  const stage = stageOf(settings, contract);
  const signed = stage === 'done';
  const hasClient = !isEmpty(v.client);

  const sigEnd = v.signatureClient && v.signatureSef ? maxDate(v.signatureClient, v.signatureSef) : null;
  const dureeRevue = days(v.receptionCc, v.revueTerminee);
  const dureeApproval = days(v.approvalLancee, v.approvalTerminee);
  const dureeSignature = v.miseEnSignature && sigEnd ? days(v.miseEnSignature, sigEnd) : null;
  const dureeTotale = v.receptionCc && sigEnd ? days(v.receptionCc, sigEnd) : null;
  const n1End = v.n1SignatureClient && v.n1SignatureSef ? maxDate(v.n1SignatureClient, v.n1SignatureSef) : null;
  const n1DureeTotale = v.n1ReceptionCc && n1End ? days(v.n1ReceptionCc, n1End) : null;

  // Jours au stade actuel : depuis le dernier changement de statut ou le dernier jalon daté.
  let joursStade = null;
  if (hasClient && actif && !signed && !sigEnd) {
    const last = maxDate(v.statutModifieLe, ...JALONS.map((k) => v[k]));
    if (last && last <= today) joursStade = diffDays(last, today);
  }

  // Signature N-1 + 1 an, et écart avec la saison en cours.
  const sigN1Plus1 = n1End ? addMonths(n1End, 12) : null;
  let ecartN1 = null;
  if (hasClient && actif && sigN1Plus1) {
    if (sigEnd) ecartN1 = diffDays(sigN1Plus1, sigEnd);
    else if (!signed) ecartN1 = diffDays(sigN1Plus1, today);
  }

  // Contrôle des jalons : chaque date doit suivre les précédentes ; aucune date dans le futur.
  const bad = [];
  let controle = '';
  const dated = JALONS.filter((k) => v[k]);
  if (hasClient && dated.length) {
    let prevMax = null;
    for (const k of JALONS) {
      const d = v[k];
      const before = k === 'signatureSef' ? maxDate(...JALONS.slice(0, 6).map((x) => v[x])) : prevMax;
      if (d && before && d < before) bad.push(k);
      if (k !== 'signatureClient') prevMax = maxDate(prevMax, d);
      else prevMax = maxDate(prevMax, d);
    }
    if (bad.length) controle = 'Ordre incohérent';
    else if (dated.some((k) => v[k] > today)) controle = 'Date future';
  }
  const future = controle === 'Date future' ? dated.filter((k) => v[k] > today) : [];


  const vig = cfg.vigilanceDays ?? 10;
  const blo = cfg.blocageDays ?? 20;
  const stadeLevel = joursStade === null ? '' : joursStade >= blo ? 'bloque' : joursStade >= vig ? 'vigilance' : '';
  const retardN1 = actif && !signed && !sigEnd && ecartN1 !== null && ecartN1 > 0;

  return {
    stage, closed, actif, role, signed, dureeRevue, dureeApproval, dureeSignature, dureeTotale, n1DureeTotale,
    joursStade, stadeLevel, sigN1Plus1, ecartN1, retardN1, controle, badJalons: bad, futureJalons: future,
  };
}

/** Alertes d'un compte, de la plus grave à la moins grave. */
export function alertsOf(settings, contract, calc) {
  const r = calc || rowCalc(settings, contract);
  const v = contract.values;
  const cfg = settings.alerts || {};
  const out = [];
  if (r.closed || isEmpty(v.client)) return out;
  if (r.controle === 'Ordre incohérent') out.push({ code: 'ordre', level: 'serious', label: 'Ordre des jalons incohérent : vérifiez les dates en rouge' });
  else if (r.controle === 'Date future') out.push({ code: 'future', level: 'warning', label: 'Un jalon est daté dans le futur' });
  if (r.stadeLevel === 'bloque') out.push({ code: 'bloque', level: 'serious', label: `${r.joursStade} j au même stade (seuil « bloqué » : ${cfg.blocageDays ?? 20} j)` });
  else if (r.stadeLevel === 'vigilance') out.push({ code: 'vigilance', level: 'warning', label: `${r.joursStade} j au même stade (seuil « à surveiller » : ${cfg.vigilanceDays ?? 10} j)` });
  if (r.retardN1) out.push({ code: 'retardN1', level: 'serious', label: `En retard vs l’an dernier : PAF N-1 signé il y a ${r.ecartN1} j de plus` });
  if (r.actif && isEmpty(v.attribution2027)) out.push({ code: 'attribution', level: 'info', label: 'Attribution CM / juriste à définir' });
  if (r.actif && r.stage === 'none') out.push({ code: 'sansStatut', level: 'info', label: 'Compte actif sans REPORT GEN' });
  if (r.actif && isEmpty(v.cm)) out.push({ code: 'noCm', level: 'info', label: 'Aucun CM référent' });
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
}

/** Calculs, étape, avancement et alertes de chaque compte. */
export function deriveAll(settings, contracts, today = todayISO()) {
  const map = new Map();
  for (const c of contracts) {
    const calc = rowCalc(settings, c, today);
    const alerts = alertsOf(settings, c, calc);
    map.set(c.id, { ...calc, progress: progressOf(settings, c), alerts, level: alerts.length ? alerts[0].level : null });
  }
  return map;
}

/* ------------------------------------------------------- Indicateurs */

/** Chiffres clés (onglet « Interface » et barre latérale). */
export function kpis(settings, contracts, derived, today = todayISO()) {
  const d = (c) => derived.get(c.id) || {};
  const tracked = contracts.filter((c) => REPORT_STAGES.includes(d(c).stage));
  const count = (fn) => contracts.filter(fn).length;
  const byStage = Object.fromEntries(REPORT_STAGES.map((st) => [st, tracked.filter((c) => d(c).stage === st).length]));
  const sig = milestoneByRole(settings, 'signature');
  const signed = byStage.done;
  return {
    total: contracts.length,
    attendus: tracked.length,
    signes: signed,
    signedPct: tracked.length ? signed / tracked.length : 0,
    byStage,
    actifs: count((c) => d(c).actif),
    fermes: count((c) => d(c).closed),
    etude: count((c) => d(c).role === 'etude'),
    nouveaux: count((c) => d(c).role === 'nouveau'),
    sansStatut: count((c) => d(c).actif && d(c).stage === 'none'),
    sansAttribution: count((c) => d(c).actif && isEmpty(c.values.attribution2027)),
    ordre: count((c) => d(c).controle === 'Ordre incohérent'),
    vigilance: count((c) => d(c).stadeLevel === 'vigilance'),
    bloques: count((c) => d(c).stadeLevel === 'bloque'),
    retardN1: count((c) => d(c).retardN1),
    daysToSignature: sig ? diffDays(today, sig.date) : null,
    signatureMilestone: sig,
  };
}

/** Groupe de reporting d'une division (MO (LCD), MO (LED), MO (LFD) → MO). */
export function divisionGroup(settings, division) {
  const opt = listOptions(settings, 'division').find((o) => o.value === division);
  return opt?.group || division || '';
}

/**
 * Tableau « statut × division » (onglets 2.Rep Gen DATA et 7.Rep Div GRAPH).
 * field : 'statut' (REPORT GEN) ou 'reportDiv'. Retourne les divisions de la liste (+ celles rencontrées).
 */
export function statusMatrix(settings, contracts, field = 'statut') {
  const statuses = listOptions(settings, field);
  const divisions = listOptions(settings, 'division').map((o) => o.value);
  const extra = [...new Set(contracts.map((c) => c.values.division).filter((x) => x && !divisions.includes(x)))];
  const rows = [...divisions, ...extra].map((div) => {
    const counts = Object.fromEntries(statuses.map((s) => [s.value, 0]));
    for (const c of contracts) {
      const v = field === 'statut' ? genOf(settings, c) : c.values[field];
      if (c.values.division === div && v in counts) counts[v]++;
    }
    return { division: div, group: divisionGroup(settings, div), counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  return { statuses, rows };
}

/**
 * Reporting général par groupe de division et par famille (onglet 4.Rep Gen TAB) :
 * nombre de contrats / PAF, signés, % signés, et répartition par étape de synthèse.
 */
export function reportByGroup(settings, contracts, derived) {
  const rep = settings.reporting || { groups: [], families: [] };
  const statuses = listOptions(settings, 'statut');
  const blank = () => ({ total: 0, signed: 0, stages: Object.fromEntries(REPORT_STAGES.map((s) => [s, 0])), statuses: Object.fromEntries(statuses.map((s) => [s.value, 0])) });
  const groups = rep.groups.map((g) => ({ ...g, ...blank() }));
  const families = rep.families.map((f) => ({ ...f, ...blank() }));
  const all = { key: 'ALL', label: 'TOTAL SEF', en: 'TOTAL SEF', ...blank() };
  const add = (acc, c, st) => {
    acc.total++;
    if (st === 'done') acc.signed++;
    acc.stages[st]++;
    const gen = genOf(settings, c);
    if (gen in acc.statuses) acc.statuses[gen]++;
  };
  for (const c of contracts) {
    const st = derived.get(c.id)?.stage;
    if (!REPORT_STAGES.includes(st)) continue;
    const gkey = divisionGroup(settings, c.values.division);
    const g = groups.find((x) => x.key === gkey);
    if (!g) continue;
    add(g, c, st);
    const f = families.find((x) => x.key === g.family);
    if (f) add(f, c, st);
    add(all, c, st);
  }
  for (const x of [...groups, ...families, all]) x.pct = x.total ? x.signed / x.total : 0;
  return { groups, families, all, statuses };
}

/** Lignes du tableau « statut » du reporting : chaque statut, sauf signature et signés cumulés. */
export function statusRowsForTab(settings, mergeStages = ['signature', 'done']) {
  const rows = [];
  for (const o of listOptions(settings, 'statut')) {
    if (mergeStages.includes(o.stage)) {
      if (!rows.some((r) => r.stage === o.stage && r.merged)) rows.push({ stage: o.stage, merged: true, values: listOptions(settings, 'statut').filter((x) => x.stage === o.stage).map((x) => x.value), color: o.color });
    } else rows.push({ stage: o.stage, merged: false, values: [o.value], value: o.value, en: o.en, color: o.color });
  }
  return rows;
}

/**
 * Charge de l'équipe (onglet 9) : comptes « actifs » par CM référent ou par juriste.
 * by : 'cm' (équipe) ou 'juriste' (liste des juristes).
 */
export function workload(settings, contracts, derived, by = 'cm') {
  const names = by === 'cm' ? (settings.team || []).map((m) => ({ key: m.id, label: m.name, color: m.color })) : listOptions(settings, 'juriste').map((o) => ({ key: o.value, label: o.value, color: o.color }));
  const blank = (key, label, color) => ({ key, label, color, actifs: 0, signes: 0, attente: 0, traitement: 0, signature: 0, sansStatut: 0, vigilance: 0, bloques: 0, retard: 0 });
  const rows = names.map((n) => blank(n.key, n.label, n.color));
  const none = blank('__none__', 'Non attribué', '#a3a7af');
  const others = new Map();
  for (const c of contracts) {
    const d = derived.get(c.id);
    if (!d?.actif) continue;
    const k = c.values[by];
    let row = isEmpty(k) ? none : rows.find((r) => r.key === k);
    if (!row) {
      if (!others.has(k)) others.set(k, blank(k, by === 'cm' ? (memberById(settings, k)?.name || String(k)) : String(k), '#a3a7af'));
      row = others.get(k);
    }
    row.actifs++;
    if (d.stage === 'done') row.signes++;
    if (d.stage === 'todo') row.attente++;
    if (d.stage === 'active') row.traitement++;
    if (d.stage === 'signature') row.signature++;
    if (d.stage === 'none') row.sansStatut++;
    if (d.stadeLevel === 'vigilance') row.vigilance++;
    if (d.stadeLevel === 'bloque') row.bloques++;
    if (d.retardN1) row.retard++;
  }
  const list = [...rows, ...others.values(), ...(none.actifs ? [none] : [])];
  const total = blank('__total__', 'Total', '');
  for (const r of list) for (const k of Object.keys(total)) if (typeof total[k] === 'number') total[k] += r[k];
  for (const r of [...list, total]) r.pct = r.actifs ? r.signes / r.actifs : null;
  return { rows: list, total };
}

/** Vendredis de la saison entre deux dates (suivi hebdomadaire). */
export function fridays(start, end) {
  const out = [];
  if (!start || !end) return out;
  let d = start;
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
  d = addDays(d, (5 - wd + 7) % 7);
  for (let i = 0; d <= end && i < 60; i++, d = addDays(d, 7)) out.push(d);
  return out;
}

/** Part des PAF N-1 entièrement signés à la même date un an plus tôt (colonne « % signés N-1 »). */
export function n1SignedPctAt(contracts, iso) {
  const ref = addMonths(iso, -12);
  const base = contracts.filter((c) => !isEmpty(c.values.n1ReportGen)).length;
  if (!base) return null;
  const n = contracts.filter((c) => c.values.n1SignatureClient && c.values.n1SignatureSef && c.values.n1SignatureClient <= ref && c.values.n1SignatureSef <= ref).length;
  return n / base;
}

/** Tableau du suivi hebdomadaire : vendredis, valeurs figées, % de la saison et de la précédente. */
export function weeklyRows(settings, contracts) {
  const h = settings.hebdo || {};
  const weeks = settings.hebdoWeeks || {};
  return fridays(h.start, h.end).map((date) => {
    const w = weeks[date] || null;
    return {
      date,
      attendus: w ? w.attendus : null,
      signes: w ? w.signes : null,
      pct: w && w.attendus ? w.signes / w.attendus : null,
      pctN1: n1SignedPctAt(contracts, date),
      figeLe: w?.figeLe || null,
      par: w?.par || '',
    };
  });
}

/** Dernier vendredi ≤ aujourd'hui dans la plage du suivi hebdomadaire (ligne à figer). */
export function weekToFreeze(settings, today = todayISO()) {
  const h = settings.hebdo || {};
  return fridays(h.start, h.end).filter((d) => d <= today).pop() || null;
}

export function personName(settings, id) {
  if (isEmpty(id)) return '';
  return memberById(settings, id)?.name || String(id);
}

export const fmtPercent = (v) => (isEmpty(v) || !Number.isFinite(Number(v)) ? '' : `${fmtNumber(Number(v) * 100, 1).replace(/,0$/, '')} %`);
export const fmtSignedDays = (n) => (n === null || n === undefined ? '' : `${n > 0 ? '+' : ''}${n} j`);

function computedDisplay(settings, contract, col, d) {
  const r = d || rowCalc(settings, contract);
  switch (col.computed) {
    case 'dureeRevue': case 'dureeApproval': case 'dureeSignature': case 'dureeTotale': case 'n1DureeTotale': case 'joursStade':
      return r[col.computed] === null || r[col.computed] === undefined ? '' : String(r[col.computed]);
    case 'sigN1Plus1': return r.sigN1Plus1 ? fmtDate(r.sigN1Plus1) : '';
    case 'ecartN1': return fmtSignedDays(r.ecartN1);
    case 'controle': return r.controle || '';
    case 'progress': return `${d?.progress ?? progressOf(settings, contract)} %`;
    case 'alerts': return (d?.alerts || alertsOf(settings, contract, r)).map((a) => a.label).join(' ; ');
    case 'updated': return contract.updatedAt ? `${fmtDateTime(contract.updatedAt)}${contract.updatedByName ? ` – ${contract.updatedByName}` : ''}` : '';
    default: return '';
  }
}

export function displayValue(settings, contract, col, derivedEntry) {
  const v = contract.values[col.key];
  switch (col.type) {
    case 'date': return fmtDate(v);
    case 'number': return isEmpty(v) ? '' : `${fmtNumber(v, col.integer ? 0 : 2)}${col.unit ? ` ${col.unit}` : ''}`;
    case 'percent': return fmtPercent(v);
    case 'multiselect': return Array.isArray(v) ? v.join(', ') : (v ?? '');
    case 'person': return personName(settings, v);
    case 'checkbox': return v ? (col.trueLabel || 'X') : '';
    case 'computed': return computedDisplay(settings, contract, col, derivedEntry);
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
      const list = listOptions(settings, col.list);
      return Math.min(...v.map((x) => { const i = list.findIndex((o) => o.value === x); return i < 0 ? 999 : i; }));
    }
    case 'number': case 'percent': return isEmpty(v) ? null : Number(v);
    case 'date': return isEmpty(v) ? null : v;
    case 'person': return isEmpty(v) ? null : norm(personName(settings, v));
    case 'checkbox': return v ? 1 : null;
    case 'computed': {
      const r = derivedEntry || rowCalc(settings, contract);
      if (['dureeRevue', 'dureeApproval', 'dureeSignature', 'dureeTotale', 'n1DureeTotale', 'joursStade', 'ecartN1'].includes(col.computed)) return r[col.computed] ?? null;
      if (col.computed === 'sigN1Plus1') return r.sigN1Plus1 || null;
      if (col.computed === 'controle') return r.controle ? (r.controle === 'Ordre incohérent' ? 2 : 1) : null;
      if (col.computed === 'alerts') { const a = derivedEntry?.alerts || []; return a.length ? LEVEL_RANK[a[0].level] * 100 + a.length : null; }
      if (col.computed === 'updated') return contract.updatedAt || null;
      if (col.computed === 'progress') return derivedEntry?.progress ?? null;
      return null;
    }
    default: {
      if (isEmpty(v)) return null;
      if (col.key === 'ref') { const n = String(v).match(/(\d+)\s*$/); return n ? Number(n[1]) : norm(v); }
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

/**
 * Mise en forme conditionnelle du classeur, cellule par cellule : renvoie une classe de ton
 * (tone-danger, tone-danger-strong, tone-warning, tone-success, tone-info, tone-purple, tone-yellow, tone-green, tone-muted).
 */
export function cellTone(settings, contract, col, d) {
  const v = contract.values[col.key];
  const r = d || rowCalc(settings, contract);
  const cfg = settings.alerts || {};
  if (col.group === 'cle' && !r.closed) {
    if (r.role === 'etude') return 'tone-yellow';
    if (r.role === 'nouveau') return 'tone-green';
  }
  switch (col.key) {
    case 'signaturePafSef': return v === 'NON' ? 'tone-danger-text' : '';
    case 'gag2026': case 'gag2027': return !isEmpty(v) && Number(v) > (cfg.gagMax ?? 0.15) ? 'tone-danger' : '';
    case 'attribution2027': if (isEmpty(v) && r.actif) return 'tone-yellow'; return v === 'JURISTE' ? 'tone-purple' : '';
    case 'attribution2026': case 'n1Attribution': return v === 'JURISTE' ? 'tone-purple' : '';
    case 'statut': case 'reportDiv': {
      const st = statusOption(settings, v, col.list)?.stage;
      return st === 'done' ? 'tone-success' : st === 'signature' ? 'tone-info' : st === 'active' ? 'tone-warning-soft' : '';
    }
    case 'n1ReportGen': case 'n1ReportDiv': {
      const list = listOptions(settings, col.list);
      return !isEmpty(v) && list.length && v !== list[list.length - 1].value ? 'tone-danger-text' : '';
    }
    default: break;
  }
  if (col.jalon && r.badJalons?.includes(col.key)) return 'tone-danger';
  if (col.jalon && r.futureJalons?.includes(col.key)) return 'tone-warning';
  if (col.type === 'computed') {
    switch (col.computed) {
      case 'dureeRevue': case 'dureeApproval': case 'dureeSignature': case 'dureeTotale': case 'n1DureeTotale':
        return r[col.computed] !== null && r[col.computed] < 0 ? 'tone-danger' : '';
      case 'joursStade': return r.stadeLevel === 'bloque' ? 'tone-danger-strong' : r.stadeLevel === 'vigilance' ? 'tone-warning' : '';
      case 'ecartN1': return r.retardN1 ? 'tone-danger-text' : '';
      case 'controle': return r.controle === 'Ordre incohérent' ? 'tone-danger' : r.controle ? 'tone-warning' : '';
      default: return '';
    }
  }
  return '';
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
    let raw = contract.values[key];
    if (key === 'divisionGroup') raw = divisionGroup(settings, contract.values.division);
    const values = Array.isArray(raw) ? raw : isEmpty(raw) ? [] : [raw];
    if (!values.length) { if (!wanted.includes('__empty__')) return false; } else if (!values.some((x) => wanted.includes(x))) return false;
  }
  const d = derivedEntry || rowCalc(settings, contract);
  switch (filters.quick) {
    case 'mine': return !!ctx.meId && contract.values.cm === ctx.meId;
    case 'actifs': return !!d.actif;
    case 'jalons': return !!d.controle;
    case 'stade': return !!d.stadeLevel;
    case 'attribution': return !!d.actif && isEmpty(contract.values.attribution2027);
    case 'signes': return d.stage === 'done';
    case 'fermes': return !!d.closed;
    default: return true;
  }
}

export const QUICK_VIEWS = [
  { id: '', label: 'Tous' },
  { id: 'mine', label: 'Mes comptes' },
  { id: 'actifs', label: 'Actifs' },
  { id: 'stade', label: 'À surveiller / bloqués' },
  { id: 'jalons', label: 'Jalons à vérifier' },
  { id: 'attribution', label: 'Attribution 2027 à faire' },
  { id: 'signes', label: 'Signés' },
  { id: 'fermes', label: 'Fermés' },
];

export { stageLabel };

/** Conversion d'une saisie texte (collage, import) vers la valeur typée d'une colonne. */
export function coerceValue(settings, col, raw, { addMissing } = {}) {
  if (raw === undefined) return undefined;
  if (col.type === 'computed') return undefined;
  const text = raw instanceof Date ? raw : typeof raw === 'string' ? raw.trim() : raw;
  if (text === '' || text === null) return col.type === 'multiselect' ? [] : col.type === 'checkbox' ? false : null;
  return coerceNonEmpty(settings, col, text, addMissing);
}

/** Pourcentage : « 28,6 % » → 0,286 ; un nombre ≤ 1,5 sans signe % est déjà une fraction (cellule Excel). */
export function parsePercent(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? (Math.abs(raw) <= 1.5 ? raw : raw / 100) : null;
  const s = String(raw);
  const n = parseNumberInput(s);
  if (n === null) return null;
  return /%/.test(s) || Math.abs(n) > 1.5 ? Math.round(n * 1000) / 100000 : n;
}

function coerceNonEmpty(settings, col, text, addMissing) {
  switch (col.type) {
    case 'number': {
      const n = parseNumberInput(text);
      return n !== null && col.integer ? Math.round(n) : n;
    }
    case 'percent': return parsePercent(text);
    case 'date': return parseDateLoose(text);
    case 'checkbox': return typeof text === 'boolean' ? text : !['non', 'no', 'faux', 'false', '0', '-', 'n'].includes(norm(text));
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
  // « 5.Attente retour DIV sur PAF » (espaces, ponctuation) ou « 1. Attente CC » : même valeur une fois compactée.
  const compact = (x) => norm(x).replace(/[^a-z0-9]/g, '');
  const loose = list.find((o) => compact(o.value) === compact(text));
  if (loose) return loose.value;
  if (addMissing) addMissing(listKey, text);
  return String(text).trim();
}

function matchMember(settings, text, addMissing) {
  const n = norm(text);
  const m = (settings.team || []).find((t) => norm(t.name) === n || norm(t.email) === n || norm(t.github) === n || norm(t.initials) === n || norm(t.id) === n)
    || (settings.team || []).find((t) => n.length >= 3 && (norm(t.name).startsWith(n) || norm(t.name).split(' ').includes(n)));
  if (m) return m.id;
  if (addMissing) return addMissing('__team__', text);
  return null;
}

export { columnByKey };

/* ------------------------------------------------------- Comptes clients */

/** Clé d'un compte client (nom sans accents ni casse). */
export const accountKey = (client) => norm(client).replace(/\s+/g, ' ').trim();

/** Première valeur renseignée d'un champ parmi les lignes d'un compte (données propres au client). */
export function clientValue(rows, key) {
  for (const c of rows) if (!isEmpty(c.values[key])) return c.values[key];
  return null;
}

/**
 * Regroupe les lignes (une par division) en comptes clients, avec leur avancement :
 * divisions ouvertes, répartition par phase, signés, équipe, dernière mise à jour, alertes.
 */
export function groupAccounts(settings, contracts, derived) {
  const map = new Map();
  for (const c of contracts) {
    const name = String(c.values.client || '').trim();
    if (!name) continue;
    const key = accountKey(name);
    if (!map.has(key)) map.set(key, { key, client: name, rows: [] });
    map.get(key).rows.push(c);
  }
  const divOrder = listOptions(settings, 'division').map((o) => o.value);
  const rank = (v) => { const i = divOrder.indexOf(v); return i < 0 ? 999 : i; };
  const levelRank = { critical: 3, serious: 2, warning: 1, info: 0 };
  const out = [];
  for (const a of map.values()) {
    const d = (c) => derived.get(c.id) || {};
    a.rows.sort((x, y) => rank(x.values.division) - rank(y.values.division) || String(x.values.division || '').localeCompare(String(y.values.division || '')));
    const open = a.rows.filter((c) => !d(c).closed);
    const tracked = open.filter((c) => REPORT_STAGES.includes(d(c).stage));
    const stages = Object.fromEntries(REPORT_STAGES.map((st) => [st, tracked.filter((c) => d(c).stage === st).length]));
    const uniq = (arr) => [...new Set(arr.filter((x) => !isEmpty(x)))];
    const roles = a.rows.map((c) => d(c).role);
    const role = !open.length ? 'ferme' : roles.includes('actif') ? 'actif' : roles.includes('nouveau') ? 'nouveau' : roles.includes('etude') ? 'etude' : roles[0] || '';
    const latest = a.rows.reduce((m, c) => ((c.updatedAt || 0) > (m?.updatedAt || 0) ? c : m), null);
    const alerts = open.flatMap((c) => (d(c).alerts || []).filter((x) => x.level !== 'info'));
    const worst = alerts.reduce((m, x) => (levelRank[x.level] > levelRank[m] ? x.level : m), 'info');
    const pending = tracked.filter((c) => d(c).stage !== 'done');
    out.push({
      ...a,
      open,
      tracked,
      stages,
      signed: stages.done,
      total: tracked.length,
      pct: tracked.length ? stages.done / tracked.length : 0,
      progress: tracked.length ? Math.round(tracked.reduce((s, c) => s + (d(c).progress || 0), 0) / tracked.length) : 0,
      minStep: pending.length ? Math.min(...pending.map((c) => stepIndex(settings, c)).filter((i) => i >= 0)) : null,
      role,
      cms: uniq(open.map((c) => c.values.cm)),
      juristes: uniq(open.map((c) => c.values.juriste)),
      kams: uniq(open.map((c) => c.values.kam)),
      updatedAt: latest?.updatedAt || 0,
      updatedBy: latest?.updatedByName || '',
      alerts,
      level: alerts.length ? worst : null,
      maxStade: Math.max(0, ...open.map((c) => d(c).joursStade || 0)),
      flags: {
        top30: a.rows.some((c) => c.values.top30), independant: a.rows.some((c) => c.values.independant),
        centraleRef: a.rows.some((c) => c.values.centraleRef), accordInternational: a.rows.some((c) => c.values.accordInternational),
      },
      activite: clientValue(a.rows, 'activite'),
    });
  }
  return out.sort((x, y) => x.client.localeCompare(y.client, 'fr', { sensitivity: 'base' }));
}

/** Informations d'affichage d'une étape : index, total, libellé court, phase. */
export function stepInfo(settings, contract) {
  const steps = listOptions(settings, 'reportDiv');
  const i = stepIndex(settings, contract);
  const opt = i >= 0 ? steps[i] : null;
  return { index: i, count: steps.length, option: opt, name: opt ? stepName(opt.value) : 'Étape non renseignée', stage: stepStage(settings, opt) };
}

export { CLIENT_FIELDS };
