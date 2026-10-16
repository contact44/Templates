// Reporting général (onglets 2 à 5 du classeur) : synthèse par étape, tableau par division
// (TOTAL SEF, CE, IM), graphique « statut par division » et données détaillées, en français ou en anglais.

import { icon } from '../ui/icons.js';
import { bindMarkTips, columnsHTML, stack100HTML } from '../ui/charts.js';
import { emptyState } from '../ui/components.js';
import { reportByGroup, statusMatrix, statusRowsForTab } from '../core/compute.js';
import { listOptions, REPORT_STAGES, stageById, stageLabel } from '../core/schema.js';
import { esc, fmtNumber } from '../core/utils.js';
import { exportMenu } from './importer.js';

const TABS = [
  { id: 'synthese', label: 'Synthèse', en: 'Summary' },
  { id: 'tableau', label: 'Tableau', en: 'Table' },
  { id: 'graphique', label: 'Graphique', en: 'Chart' },
  { id: 'donnees', label: 'Données', en: 'Data' },
];

export function dateTitle(today, lang) {
  const [y, m, d] = today.split('-');
  return lang === 'en' ? `${y}/${m}/${Number(d)}` : `${Number(d)}/${m}/${y}`;
}

export function mount(el, ctx, { sub } = {}) {
  const { store } = ctx;
  let tab = TABS.some((t) => t.id === sub) ? sub : 'synthese';
  el.innerHTML = `<div class="page page-report">
    <div class="report-bar">
      <div class="seg-ctrl" role="tablist" aria-label="Vues du reporting"></div>
      <div class="report-tools">
        <div class="seg-ctrl small" role="group" aria-label="Langue du reporting"><button data-lang="fr">FR</button><button data-lang="en">EN</button></div>
        <button class="btn btn-ghost btn-sm" data-act="print">${icon('print')}<span>Imprimer</span></button>
        <button class="btn btn-secondary btn-sm" data-act="export">${icon('download')}<span>Exporter</span></button>
      </div>
    </div>
    <div class="report-body"></div>
  </div>`;
  const page = el.firstElementChild;
  const body = page.querySelector('.report-body');
  bindMarkTips(body);
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const stageColor = (id) => (dark() ? stageById(id).darkColor : stageById(id).color);

  function render() {
    const s = store.state.settings;
    const lang = store.state.prefs.reportLang === 'en' ? 'en' : 'fr';
    const L = (fr, en) => (lang === 'en' ? en : fr);
    page.querySelector('[role="tablist"]').innerHTML = TABS.map((t) => `<button role="tab" class="${t.id === tab ? 'active' : ''}" aria-selected="${t.id === tab}" data-tab="${t.id}">${esc(L(t.label, t.en))}</button>`).join('');
    page.querySelectorAll('[data-lang]').forEach((b) => { b.classList.toggle('active', b.dataset.lang === lang); b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    const list = store.state.list;
    if (!list.length) { body.innerHTML = emptyState({ iconName: 'dashboard', title: 'Aucune donnée', text: 'Importez le fichier « Suivi CM » pour alimenter les reportings.' }); return; }
    const rep = reportByGroup(s, list, store.state.derived);
    const today = store.state.today;
    if (tab === 'synthese') body.innerHTML = synthese(s, rep, lang, today);
    if (tab === 'tableau') body.innerHTML = tableau(s, rep, lang, today);
    if (tab === 'graphique') body.innerHTML = graphique(s, rep, lang, today);
    if (tab === 'donnees') body.innerHTML = donnees(s, list, rep);
  }

  function synthese(s, rep, lang, today) {
    const L = (fr, en) => (lang === 'en' ? en : fr);
    const parts = REPORT_STAGES.map((st) => ({ label: stageLabel(s, st, lang), value: rep.all.stages[st], color: stageColor(st) }));
    const statuses = listOptions(s, 'statut');
    const defs = REPORT_STAGES.map((st) => {
      const nums = statuses.map((o, i) => (o.stage === st ? i + 1 : null)).filter(Boolean);
      return `<li><span class="legend-swatch" style="--c:${esc(stageColor(st))}"></span><strong>${esc(stageLabel(s, st, lang))}</strong> — ${L('statuts', 'statuses')} ${nums.join(', ')}</li>`;
    }).join('');
    return `<section class="card report-card">
      <header class="card-head"><div><h2>${esc(L(`État d’avancement SEF au ${dateTitle(today, 'fr')}`, `SEF progress report on ${dateTitle(today, 'en')}`))}</h2><p class="card-sub">${esc(L('Tous les comptes ayant un REPORT GEN', 'All accounts with a general status'))}</p></div></header>
      <div class="synth-kpis">${REPORT_STAGES.map((st) => `<div class="kpi" style="--c:${esc(stageColor(st))}"><span class="kpi-label"><span class="legend-swatch" style="--c:${esc(stageColor(st))}"></span>${esc(stageLabel(s, st, lang))}</span><span class="kpi-value">${fmtNumber(rep.all.stages[st])}</span></div>`).join('')}</div>
      ${stack100HTML(parts)}
      <div class="synth-big">
        <div><span class="big-num">${fmtNumber(rep.all.signed)}</span><span>${esc(L('contrats / PAF signés', 'contracts / PAF signed'))}</span></div>
        <div><span class="big-num">${fmtNumber(rep.all.total)}</span><span>${esc(L('contrats / PAF attendus', 'contracts / PAF to be signed'))}</span></div>
        <div><span class="big-num">${Math.round(rep.all.pct * 100)} %</span><span>${esc(L('de contrats signés', 'signed'))}</span></div>
      </div>
      <ul class="plain synth-defs">${defs}</ul>
    </section>`;
  }

  function cols(rep, lang) {
    const fam = (key) => rep.families.find((f) => f.key === key);
    const out = [{ ...rep.all, label: lang === 'en' ? rep.all.en : rep.all.label, isTotal: true }];
    for (const f of rep.families) {
      out.push({ ...fam(f.key), label: lang === 'en' ? f.en : f.label, family: true });
      for (const g of rep.groups.filter((x) => x.family === f.key)) out.push({ ...g, label: lang === 'en' ? g.en : g.label });
    }
    for (const g of rep.groups.filter((x) => !rep.families.some((f) => f.key === x.family))) out.push({ ...g, label: lang === 'en' ? g.en : g.label });
    return out;
  }

  function tableau(s, rep, lang, today) {
    const L = (fr, en) => (lang === 'en' ? en : fr);
    const c = cols(rep, lang);
    const kind = (x) => (x.isTotal ? 'is-total' : x.family ? 'is-family' : '');
    const cell = (v, x) => `<td class="${kind(x)}${v === 0 ? ' is-zero' : ''}">${v === null ? '' : esc(String(v))}</td>`;
    const head = (first, sub) => `<tr class="${sub ? 'subhead' : ''}"><th scope="col">${esc(first)}</th>${c.map((x) => `<th scope="col" class="${kind(x)}">${esc(x.label)}</th>`).join('')}</tr>`;
    const rows = statusRowsForTab(s);
    let n = 0;
    const statusRows = rows.map((r) => {
      n++;
      const label = r.merged ? `${n}.${stageLabel(s, r.stage, lang)}` : (lang === 'en' && r.en ? r.en : r.value);
      const val = (x) => r.values.reduce((a, v) => a + (x.statuses[v] || 0), 0);
      return `<tr><th scope="row"><span class="legend-swatch" style="--c:${esc(r.color)}"></span>${esc(label)}</th>${c.map((x) => cell(val(x), x)).join('')}</tr>`;
    }).join('');
    const sumStatus = rep.all.total;
    const ok = sumStatus === rows.reduce((a, r) => a + r.values.reduce((b, v) => b + (rep.all.statuses[v] || 0), 0), 0);
    return `<section class="card report-card">
      <header class="card-head"><div><h2>${esc(L('Suivi des contrats', 'Contract follow-up'))}</h2><p class="card-sub">${esc(L(`Situation au ${dateTitle(today, 'fr')}`, `Status on ${dateTitle(today, 'en')}`))}</p></div></header>
      <div class="table-scroll" tabindex="0"><table class="report-table report-tab">
        <colgroup><col class="col-label">${c.map(() => '<col>').join('')}</colgroup>
        <thead>${head(L('Suivi général', 'General reporting'))}</thead>
        <tbody>
          <tr><th scope="row">${esc(L('Nombre de contrats / PAF', 'Number of contracts / PAF'))}</th>${c.map((x) => cell(x.total, x)).join('')}</tr>
          <tr><th scope="row">${esc(L('Nombre de contrats / PAF signés', 'Number of contracts / PAF signed'))}</th>${c.map((x) => cell(x.signed, x)).join('')}</tr>
          <tr class="row-pct"><th scope="row">${esc(L('% contrats signés', '% signed contracts'))}</th>${c.map((x) => `<td class="${kind(x)}">${x.total ? `${Math.round(x.pct * 100)} %` : '—'}</td>`).join('')}</tr>
          <tr class="row-gap" aria-hidden="true"><td colspan="${c.length + 1}"></td></tr>
          ${head(L('Statut', 'Status'), true)}
          ${statusRows}
        </tbody>
      </table></div>
      <p class="check-line ${ok ? 'ok' : 'bad'}">${icon(ok ? 'checkCircle' : 'alertCircle')}${esc(L(ok ? 'Contrôle de cohérence entre les deux tableaux : OK' : 'Contrôle de cohérence : écart entre les deux tableaux', ok ? 'Consistency check between both tables: OK' : 'Consistency check: tables differ'))}</p>
    </section>`;
  }

  function graphique(s, rep, lang, today) {
    const L = (fr, en) => (lang === 'en' ? en : fr);
    const statuses = listOptions(s, 'statut');
    const segments = [];
    for (const o of statuses) {
      if (o.stage === 'done') { if (!segments.some((x) => x.key === '__done')) segments.push({ key: '__done', label: `${segments.length + 1}.${stageLabel(s, 'done', lang)}`, color: o.color, values: statuses.filter((x) => x.stage === 'done').map((x) => x.value) }); } else segments.push({ key: o.value, label: lang === 'en' && o.en ? o.en : o.value, color: o.color, values: [o.value] });
    }
    const groups = rep.groups.map((g) => ({ key: g.key, label: lang === 'en' ? g.en : g.label, total: g.total, counts: Object.fromEntries(segments.map((sg) => [sg.key, sg.values.reduce((a, v) => a + (g.statuses[v] || 0), 0)])) }));
    return `<section class="card report-card">
      <header class="card-head"><div><h2>${esc(L(`Statut par division au ${dateTitle(today, 'fr')}`, `Div status report on ${dateTitle(today, 'en')}`))}</h2><p class="card-sub">${esc(L('Nombre de contrats / PAF (signés et clôturés SELMS cumulés)', 'Number of contracts / PAF (signed and closed in SELMS combined)'))}</p></div></header>
      ${columnsHTML(groups, segments, { height: 300, unit: L('contrats / PAF', 'contracts / PAF') })}
    </section>`;
  }

  function donnees(s, list, rep) {
    const m = statusMatrix(s, list, 'statut');
    const groupsOrder = rep.groups;
    const rows = [];
    for (const g of groupsOrder) {
      const members = m.rows.filter((r) => r.group === g.key);
      for (const r of members) rows.push({ label: r.division, counts: r.counts, total: r.total });
      if (members.length > 1) {
        const counts = Object.fromEntries(m.statuses.map((o) => [o.value, members.reduce((a, r) => a + r.counts[o.value], 0)]));
        rows.push({ label: g.label, counts, total: members.reduce((a, r) => a + r.total, 0), sub: true });
      }
    }
    for (const r of m.rows.filter((x) => !groupsOrder.some((g) => g.key === x.group))) rows.push({ label: `${r.division} (hors regroupement)`, counts: r.counts, total: r.total, orphan: true });
    const leaf = rows.filter((r) => !r.sub);
    const totals = Object.fromEntries(m.statuses.map((o) => [o.value, leaf.reduce((a, r) => a + r.counts[o.value], 0)]));
    const grand = leaf.reduce((a, r) => a + r.total, 0);
    const consistent = grand === rep.all.total + leaf.filter((r) => r.orphan).reduce((a, r) => a + r.total, 0);
    return `<section class="card report-card">
      <header class="card-head"><div><h2>Données : REPORT GEN par division</h2><p class="card-sub">Base des reportings (onglet « Rep Gen DATA ») · ${fmtNumber(grand)} contrats / PAF</p></div></header>
      <div class="table-scroll" tabindex="0"><table class="report-table dense">
        <thead><tr><th scope="col">Division</th>${m.statuses.map((o) => `<th scope="col" data-tip="${esc(o.value)}"><span class="legend-swatch" style="--c:${esc(o.color)}"></span>${esc(o.value.replace(/^(\d+)\..*/, '$1'))}</th>`).join('')}<th scope="col" class="is-total">Totaux</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.sub ? 'row-sub' : ''}${r.orphan ? ' row-warn' : ''}"><th scope="row">${esc(r.label)}</th>${m.statuses.map((o) => `<td class="${r.counts[o.value] ? '' : 'is-zero'}">${r.counts[o.value]}</td>`).join('')}<td class="is-total">${r.total}</td></tr>`).join('')}
          <tr class="row-total"><th scope="row">Total général</th>${m.statuses.map((o) => `<td>${totals[o.value]}</td>`).join('')}<td class="is-total">${grand}</td></tr></tbody>
      </table></div>
      <ul class="plain small muted status-key">${m.statuses.map((o) => `<li><span class="legend-swatch" style="--c:${esc(o.color)}"></span>${esc(o.value)}</li>`).join('')}</ul>
      <p class="check-line ${consistent ? 'ok' : 'bad'}">${icon(consistent ? 'checkCircle' : 'alertCircle')}${consistent ? 'Contrôle de cohérence avec le tableau général : OK' : 'Des divisions ne sont rattachées à aucun regroupement (Paramètres › Reportings)'}</p>
    </section>`;
  }

  page.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; ctx.replaceRoute?.(`reporting/${tab}`); render(); return; }
    const l = e.target.closest('[data-lang]');
    if (l) { store.setPrefs({ reportLang: l.dataset.lang }); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'print') window.print();
    if (act === 'export') exportMenu(e.target.closest('button'), ctx, {});
  });

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; render(); }); }; })();
  return {
    update(evt) { if (evt === 'data' || evt === 'settings' || evt === 'prefs') schedule(); },
    route({ sub: next }) { if (TABS.some((x) => x.id === next) && next !== tab) { tab = next; render(); } },
  };
}
