// Comptes clients : un compte par client, ses divisions et leur avancement d'un coup d'œil.
// Recherche, filtres (CM, juriste, division, phase, statut du compte), tri. Un clic ouvre la fiche du compte.

import { icon } from '../ui/icons.js';
import { avatar, emptyState, stageColor } from '../ui/components.js';
import { phaseBarHTML, phaseShort, trackHTML } from '../ui/steps.js';
import { exportMenu, openImportDialog } from './importer.js';
import { divisionGroup, groupAccounts, stepInfo } from '../core/compute.js';
import { listOptions, REPORT_STAGES, stageLabel } from '../core/schema.js';
import { buildDemo } from '../core/demo.js';
import { esc, fmtNumber, fmtRelative, norm } from '../core/utils.js';
import { toast } from '../ui/overlay.js';

const SORTS = [
  { id: 'nom', label: 'Nom du client (A → Z)' },
  { id: 'avancement', label: 'Les moins avancés d’abord' },
  { id: 'avance', label: 'Les plus avancés d’abord' },
  { id: 'maj', label: 'Dernière mise à jour' },
  { id: 'stade', label: 'Plus longtemps sans changement d’étape' },
];
const DEFAULT = { search: '', cm: '', juriste: '', division: '', phase: '', statut: 'ouverts', sort: 'nom' };

export const accountHref = (key) => `#/compte/${encodeURIComponent(key)}`;

export function mount(el, ctx) {
  const { store } = ctx;
  el.innerHTML = '<div class="page page-accounts"></div>';
  const page = el.firstElementChild;
  const f = () => ({ ...DEFAULT, ...(store.state.prefs.accounts || {}) });
  const setF = (patch) => store.setPrefs({ accounts: { ...f(), ...patch } });

  function filtered(accounts, { ignorePhase = false } = {}) {
    const q = norm(f().search);
    const me = store.meMember()?.id;
    const { cm, juriste, division, phase, statut } = f();
    return accounts.filter((a) => {
      if (statut === 'ouverts' && a.role === 'ferme') return false;
      if (statut === 'fermes' && a.role !== 'ferme') return false;
      if (statut === 'mine' && !a.cms.includes(me)) return false;
      if (cm && !(cm === '__none__' ? !a.cms.length : a.cms.includes(cm))) return false;
      if (juriste && !a.juristes.includes(juriste)) return false;
      if (division && !a.rows.some((c) => divisionGroup(store.state.settings, c.values.division) === division)) return false;
      if (phase && !ignorePhase && !a.tracked.some((c) => store.state.derived.get(c.id)?.stage === phase)) return false;
      if (q) {
        const hay = norm([a.client, a.activite, ...a.kams, ...a.juristes, ...a.cms.map((id) => store.member(id)?.name), ...a.rows.map((c) => `${c.values.division} ${c.values.selms || ''} ${c.values.codeGerp || ''} ${c.values.suiviCm || ''}`)].join(' '));
        if (!q.split(' ').every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }

  function sorted(list) {
    const by = f().sort;
    const cmp = {
      nom: (a, b) => a.client.localeCompare(b.client, 'fr', { sensitivity: 'base' }),
      avancement: (a, b) => a.progress - b.progress || a.client.localeCompare(b.client, 'fr'),
      avance: (a, b) => b.progress - a.progress || a.client.localeCompare(b.client, 'fr'),
      maj: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
      stade: (a, b) => b.maxStade - a.maxStade || a.client.localeCompare(b.client, 'fr'),
    }[by] || (() => 0);
    return list.slice().sort(cmp);
  }

  function divisionPill(c) {
    const s = store.state.settings;
    const info = stepInfo(s, c);
    const d = store.state.derived.get(c.id) || {};
    const tip = `${c.values.division || 'Division ?'} — ${info.index >= 0 ? `étape ${info.index + 1}/${info.count} : ${info.name}` : 'étape non renseignée'}${d.closed ? ' (fermé)' : ''}`;
    return `<span class="div-pill${d.closed ? ' is-closed' : ''}${info.stage === 'done' ? ' is-done' : ''}" data-tip="${esc(tip)}">
      <span class="dp-code">${esc(c.values.division || '?')}</span>${trackHTML(s, c, { size: 'xs', closed: d.closed })}</span>`;
  }

  function row(a) {
    const s = store.state.settings;
    const cm = a.cms.map((id) => store.member(id)).filter(Boolean);
    const role = listOptions(s, 'statutCompte').find((o) => o.role === a.role);
    const badges = [
      a.role && a.role !== 'actif' ? `<span class="mini-badge" style="--c:${esc(role?.color || '#8d9099')}">${esc(role?.value || a.role)}</span>` : '',
      a.flags.top30 ? '<span class="mini-badge brand">TOP 30</span>' : '',
      a.flags.independant ? '<span class="mini-badge">Indépendant</span>' : '',
      a.level === 'serious' || a.level === 'critical' ? `<span class="mini-badge warn" data-tip="${esc(a.alerts.map((x) => x.label).join('\n'))}">${icon('clock')}${a.maxStade} j</span>` : '',
    ].join('');
    const closedN = a.rows.length - a.open.length;
    return `<a class="acc-row" href="${accountHref(a.key)}" data-key="${esc(a.key)}">
      <span class="acc-name"><strong>${esc(a.client)}</strong><span class="acc-badges">${badges}</span>
        <span class="acc-sub">${a.open.length} division${a.open.length > 1 ? 's' : ''}${closedN ? ` · ${closedN} fermée${closedN > 1 ? 's' : ''}` : ''}${a.activite ? ` · ${esc(a.activite)}` : ''}</span></span>
      <span class="acc-divs">${(a.open.length ? a.open : a.rows).map(divisionPill).join('')}</span>
      <span class="acc-progress">${phaseBarHTML(s, a.stages, { height: 8 })}<span class="acc-pct"><strong>${a.signed}</strong> / ${a.total} signé${a.total > 1 ? "s" : ""}</span></span>
      <span class="acc-team">${cm.length ? cm.map((m) => avatar(m)).join('') : avatar(null)}<span class="acc-team-txt"><span>${esc(cm.map((m) => m.name).join(', ') || 'CM à attribuer')}</span><span class="muted">${esc(a.juristes.join(', ') || '—')}</span></span></span>
      <span class="acc-upd muted">${a.updatedAt ? esc(fmtRelative(a.updatedAt)) : ''}${icon('chevronRight')}</span>
    </a>`;
  }

  function render() {
    const s = store.state.settings;
    const all = groupAccounts(s, store.state.list, store.state.derived);
    if (!all.length) {
      page.innerHTML = emptyState({
        iconName: 'users', title: 'Aucun compte client', text: 'Importez votre fichier « Suivi CM » (.xlsx ou .xlsm) ou essayez l’outil avec des données fictives.',
        actions: `<button class="btn btn-primary" data-act="import">${icon('upload')}<span>Importer le fichier Suivi CM</span></button><button class="btn btn-ghost" data-act="demo">${icon('sparkle')}<span>Données fictives</span></button>`,
      });
      return;
    }
    const cur = f();
    // Bandeau des phases : nombre de dossiers (divisions) par phase, cliquable (hors filtre de phase).
    const scope = filtered(all, { ignorePhase: true });
    const counts = Object.fromEntries(REPORT_STAGES.map((st) => [st, scope.reduce((n, a) => n + a.stages[st], 0)]));
    const totalDossiers = REPORT_STAGES.reduce((n, st) => n + counts[st], 0);
    const list = sorted(filtered(all));
    const groups = [...new Set(listOptions(s, 'division').map((o) => o.group || o.value))];
    const sel = (key, label, options) => `<label class="fsel${cur[key] ? ' on' : ''}"><span class="sr-only">${esc(label)}</span><select data-f="${key}" aria-label="${esc(label)}"><option value="">${esc(label)}</option>${options.map((o) => `<option value="${esc(o.value)}" ${cur[key] === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${icon('chevronDown')}</label>`;
    const active = cur.search || cur.cm || cur.juriste || cur.division || cur.phase || cur.statut !== 'ouverts';
    page.innerHTML = `
      <section class="phase-strip" role="group" aria-label="Dossiers par phase">
        <button class="ps-card${!cur.phase ? ' on' : ''}" data-phase=""><span class="ps-label">Tous les dossiers</span><span class="ps-num">${fmtNumber(totalDossiers)}</span><span class="ps-sub">${fmtNumber(scope.length)} comptes</span></button>
        ${REPORT_STAGES.map((st) => `<button class="ps-card${cur.phase === st ? ' on' : ''}" data-phase="${st}" style="--c:${esc(stageColor(st))}"><span class="ps-label"><span class="ps-dot"></span>${esc(stageLabel(s, st))}</span><span class="ps-num">${fmtNumber(counts[st])}</span><span class="ps-sub">${totalDossiers ? Math.round((counts[st] / totalDossiers) * 100) : 0} % des dossiers</span></button>`).join('')}
      </section>
      <section class="acc-toolbar">
        <label class="search big">${icon('search')}<input type="search" data-f="search" placeholder="Rechercher un client, un KAM, un juriste, un n° SELMS…" value="${esc(cur.search)}" aria-label="Rechercher"></label>
        <div class="acc-filters">
          ${sel('statut', 'Statut', [{ value: 'ouverts', label: 'Comptes ouverts' }, { value: 'mine', label: 'Mes comptes' }, { value: 'tous', label: 'Tous les comptes' }, { value: 'fermes', label: 'Comptes fermés' }]).replace('<option value="">Statut</option>', '')}
          ${sel('cm', 'CM référent', [...(s.team || []).map((m) => ({ value: m.id, label: m.name })), { value: '__none__', label: 'Sans CM' }])}
          ${sel('juriste', 'Juriste', listOptions(s, 'juriste').map((o) => ({ value: o.value, label: o.value })))}
          ${sel('division', 'Division', groups.map((g) => ({ value: g, label: g })))}
          ${sel('sort', 'Tri', SORTS.map((o) => ({ value: o.id, label: o.label }))).replace('<option value="">Tri</option>', '')}
          ${active ? `<button class="link-btn" data-act="reset">${icon('close')}Effacer les filtres</button>` : ''}
        </div>
        <div class="acc-actions">
          <button class="btn btn-ghost btn-sm" data-act="import">${icon('upload')}<span>Importer</span></button>
          <button class="btn btn-ghost btn-sm" data-act="export">${icon('download')}<span>Exporter</span></button>
          <a class="btn btn-ghost btn-sm" href="#/tableur" data-tip="Toutes les colonnes du fichier, pour une saisie en masse">${icon('table')}<span>Vue tableur</span></a>
        </div>
      </section>
      <section class="card acc-list" aria-label="Comptes clients">
        <div class="acc-head" aria-hidden="true"><span>Client</span><span>Divisions et avancement</span><span>Synthèse</span><span>CM · juriste</span><span>Mise à jour</span></div>
        ${list.map(row).join('') || `<div class="pad center muted">Aucun compte ne correspond à ces critères. <button class="link-btn" data-act="reset">Effacer les filtres</button></div>`}
      </section>
      <p class="muted small center">${fmtNumber(list.length)} compte(s) affiché(s) sur ${fmtNumber(all.length)} · les barres montrent l’étape de chaque division (REPORT PAR DIV), colorée par phase : ${REPORT_STAGES.map((st) => `<span class="legend-inline"><span class="ps-dot" style="--c:${esc(stageColor(st))}"></span>${esc(phaseShort(s, st))}</span>`).join(' ')}</p>`;
  }

  page.addEventListener('input', (e) => {
    if (e.target.matches('[data-f="search"]')) {
      clearTimeout(page._t);
      page._t = setTimeout(() => { setF({ search: e.target.value }); }, 180);
    }
  });
  page.addEventListener('change', (e) => { const s = e.target.closest('select[data-f]'); if (s) setF({ [s.dataset.f]: s.value }); });
  page.addEventListener('click', async (e) => {
    const ph = e.target.closest('[data-phase]');
    if (ph) { setF({ phase: ph.dataset.phase }); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') setF({ ...DEFAULT, sort: f().sort });
    if (act === 'import') openImportDialog(ctx);
    if (act === 'export') exportMenu(e.target.closest('button'), ctx, {});
    if (act === 'demo') { await store.loadDemo(buildDemo); toast('Données fictives chargées.', { type: 'success' }); }
  });

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; const focused = document.activeElement?.matches?.('[data-f="search"]'); const pos = focused ? document.activeElement.selectionStart : null; render(); if (focused) { const i = page.querySelector('[data-f="search"]'); i.focus(); i.setSelectionRange(pos, pos); } }); }; })();
  return { update(evt, patch) { if (evt === 'data' || evt === 'settings' || (evt === 'prefs' && patch && 'accounts' in patch)) schedule(); } };
}
