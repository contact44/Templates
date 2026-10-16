// Reporting par division (onglets 6 et 7 du classeur) : avancement d'une division (ou d'un regroupement
// comme MO), filtrable par CM référent et par juriste, et liste des dossiers de la sélection avec leur étape.

import { icon } from '../ui/icons.js';
import { bindMarkTips, donutHTML } from '../ui/charts.js';
import { avatar, emptyState } from '../ui/components.js';
import { phaseBadge, trackHTML } from '../ui/steps.js';
import { accountHref } from './accounts.js';
import { accountKey, divisionGroup, personName, stepInfo, stepIndex, stepStage } from '../core/compute.js';
import { listOptions, stageLabel } from '../core/schema.js';
import { esc, fmtNumber, isEmpty } from '../core/utils.js';
import { dateTitle } from './report-gen.js';

export function mount(el, ctx) {
  const { store } = ctx;
  el.innerHTML = '<div class="page page-report page-div"></div>';
  const page = el.firstElementChild;
  bindMarkTips(page);

  const filters = () => ({ group: '', cm: '', juriste: '', ...(store.state.prefs.divFilters || {}) });

  function matches(c, f) {
    const s = store.state.settings;
    if (f.group) {
      const isGroup = (s.reporting?.groups || []).some((g) => g.key === f.group);
      if (isGroup ? divisionGroup(s, c.values.division) !== f.group : c.values.division !== f.group) return false;
    }
    if (f.cm && c.values.cm !== f.cm) return false;
    if (f.juriste && c.values.juriste !== f.juriste) return false;
    return true;
  }

  function render() {
    const s = store.state.settings;
    const f = filters();
    const mode = store.state.prefs.divMode === 'percent' ? 'percent' : 'count';
    if (!store.state.list.length) { page.innerHTML = emptyState({ iconName: 'target', title: 'Aucune donnée', text: 'Importez le fichier « Suivi CM » pour alimenter ce reporting.' }); return; }
    const derived = store.state.derived;
    const rows = store.state.list.filter((c) => !isEmpty(c.values.client) && matches(c, f));
    const statuses = listOptions(s, 'reportDiv');
    // Comme dans le classeur : « signé » et « clôturé SELMS » cumulés en une seule part.
    const stepOf = (c) => { const i = stepIndex(s, c); return i >= 0 ? statuses[i].value : null; };
    const slices = [];
    for (const o of statuses) {
      if (stepStage(s, o) === 'done') {
        const doneVals = statuses.filter((x) => stepStage(s, x) === 'done').map((x) => x.value);
        if (!slices.some((x) => x.done)) slices.push({ label: o.value, color: o.color, value: rows.filter((c) => doneVals.includes(stepOf(c))).length, done: true });
      } else slices.push({ label: o.value, color: o.color, value: rows.filter((c) => stepOf(c) === o.value).length });
    }
    const total = slices.reduce((a, x) => a + x.value, 0);
    const signed = slices.find((x) => x.done)?.value || 0;
    const groups = s.reporting?.groups || [];
    const divOpts = listOptions(s, 'division');
    const groupOptions = groups.map((g) => {
      const members = divOpts.filter((o) => (o.group || o.value) === g.key);
      return `<option value="${esc(g.key)}" ${f.group === g.key ? 'selected' : ''}>${esc(g.label)}${members.length > 1 ? ' (toutes)' : ''}</option>${members.length > 1 ? members.map((o) => `<option value="${esc(o.value)}" ${f.group === o.value ? 'selected' : ''}>&nbsp;&nbsp;${esc(o.value)}</option>`).join('') : ''}`;
    }).join('');
    const title = `Avancement global ${f.group ? `de la division ${f.group}` : 'de toutes les divisions'}${f.cm ? ` – CM : ${personName(s, f.cm)}` : ''}${f.juriste ? ` – juriste : ${f.juriste}` : ''} au ${dateTitle(store.state.today, 'fr')}`;

    const rank = (c) => { const i = stepIndex(s, c); return i < 0 ? 999 : i; };
    const dossiers = rows.filter((c) => !derived.get(c.id)?.closed).sort((x, y) => rank(x) - rank(y) || String(x.values.client).localeCompare(String(y.values.client), 'fr'));
    page.innerHTML = `
      <section class="card div-filters">
        <label class="field inline"><span class="field-label">Division</span><select class="input" data-f="group"><option value="">Toutes les divisions</option>${groupOptions}</select></label>
        <label class="field inline"><span class="field-label">CM référent</span><select class="input" data-f="cm"><option value="">(Tous)</option>${(s.team || []).map((m) => `<option value="${esc(m.id)}" ${f.cm === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
        <label class="field inline"><span class="field-label">Juriste</span><select class="input" data-f="juriste"><option value="">(Tous)</option>${listOptions(s, 'juriste').map((o) => `<option value="${esc(o.value)}" ${f.juriste === o.value ? 'selected' : ''}>${esc(o.value)}</option>`).join('')}</select></label>
        <div class="seg-ctrl small" role="group" aria-label="Affichage"><button data-mode="count" class="${mode === 'count' ? 'active' : ''}" aria-pressed="${mode === 'count'}">Nombre</button><button data-mode="percent" class="${mode === 'percent' ? 'active' : ''}" aria-pressed="${mode === 'percent'}">%</button></div>
        ${f.group || f.cm || f.juriste ? `<button class="link-btn" data-act="reset">${icon('close')}Réinitialiser</button>` : ''}
      </section>

      <section class="card report-card">
        <header class="card-head"><div><h2>${esc(title)}</h2><p class="card-sub">${fmtNumber(rows.length)} ligne(s) · ${fmtNumber(total)} avec un REPORT PAR DIV · ${fmtNumber(signed)} signée(s) ou clôturée(s)</p></div><button class="btn btn-ghost btn-sm" data-act="open-suivi">${icon('users')}<span>Voir les comptes</span></button></header>
        ${total ? donutHTML(slices, { mode, size: 220, center: { value: `${total ? Math.round((signed / total) * 100) : 0} %`, label: 'signés' } }) : '<p class="muted">Aucune ligne avec un REPORT PAR DIV pour cette sélection.</p>'}
      </section>

      <section class="card report-card">
        <header class="card-head"><div><h2>Dossiers de la sélection</h2><p class="card-sub">${fmtNumber(dossiers.length)} dossier(s) ouverts, du moins avancé au plus avancé · cliquez pour ouvrir le compte</p></div></header>
        <ul class="dossier-list">${dossiers.slice(0, 80).map((c) => { const info = stepInfo(s, c); const d = derived.get(c.id) || {}; return `<li><a class="dossier-row" href="${accountHref(accountKey(c.values.client))}"><span class="dr-client"><strong>${esc(c.values.client)}</strong><span class="mini-badge">${esc(c.values.division || '?')}</span></span><span class="dr-track">${trackHTML(s, c, { size: 'sm' })}<span class="small">${info.index >= 0 ? `${info.index + 1}. ${esc(info.name)}` : '<span class="muted">Étape non renseignée</span>'}</span></span><span class="dr-phase">${info.index >= 0 ? phaseBadge(s, info.stage) : ''}</span><span class="dr-team">${c.values.cm ? avatar(store.member(c.values.cm)) : ''}<span class="small">${esc(personName(s, c.values.cm) || '')}${c.values.juriste ? `<br><span class="muted">${esc(c.values.juriste)}</span>` : ''}</span></span><span class="dr-days small ${d.stadeLevel ? `lvl-${d.stadeLevel}` : 'muted'}">${d.joursStade !== null && d.joursStade !== undefined && info.stage !== 'done' ? `${d.joursStade} j` : ''}</span></a></li>`; }).join('') || '<li class="muted pad-sm">Aucun dossier pour cette sélection.</li>'}</ul>
        ${dossiers.length > 80 ? `<p class="muted small pad-sm">80 premiers dossiers affichés : affinez la sélection ou ouvrez la liste des comptes.</p>` : ''}
      </section>

      <p class="muted small">${esc(stageLabel(s, 'done'))} : « signé » et « clôturé SELMS » sont cumulés, comme dans le classeur.</p>`;
  }

  page.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-f]');
    if (sel) store.setPrefs({ divFilters: { ...filters(), [sel.dataset.f]: sel.value } });
  });
  page.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { store.setPrefs({ divMode: m.dataset.mode }); return; }
    const o = e.target.closest('[data-open]');
    if (o) { ctx.openContract(o.dataset.open); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reset') store.setPrefs({ divFilters: { group: '', cm: '', juriste: '' } });
    if (act === 'open-suivi') {
      const f = filters();
      const s = store.state.settings;
      const group = f.group ? ((s.reporting?.groups || []).some((g) => g.key === f.group) ? f.group : divisionGroup(s, f.group)) : '';
      store.setPrefs({ accounts: { ...(store.state.prefs.accounts || {}), search: '', phase: '', statut: 'ouverts', division: group, cm: f.cm || '', juriste: f.juriste || '' } });
      ctx.navigate('comptes');
    }
  });
  page.addEventListener('keydown', (e) => { const o = e.target.closest('[data-open]'); if (o && e.target === o && e.key === 'Enter') ctx.openContract(o.dataset.open); });

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; render(); }); }; })();
  return { update(evt) { if (evt === 'data' || evt === 'settings' || evt === 'prefs') schedule(); } };
}
