// Tableau de bord : la situation de la saison en un coup d'œil — compte à rebours, dossiers par phase,
// répartition par étape (REPORT PAR DIV), avancement par division, par CM et par juriste, dossiers qui
// n'avancent plus, activité récente de l'équipe et notes partagées.

import { icon } from '../ui/icons.js';
import { avatar, safeUrl, stageColor } from '../ui/components.js';
import { toast } from '../ui/overlay.js';
import { phaseBarHTML, phases } from '../ui/steps.js';
import { accountHref } from './accounts.js';
import { openImportDialog } from './importer.js';
import { accountKey, divisionGroup, groupAccounts, kpis, stepIndex, workload } from '../core/compute.js';
import { listOptions, REPORT_STAGES, stageLabel, stepName } from '../core/schema.js';
import { buildDemo } from '../core/demo.js';
import { esc, fmtCountdown, fmtDate, fmtDateTime, fmtNumber, fmtRelative } from '../core/utils.js';

export function mount(el, ctx) {
  const { store } = ctx;
  el.innerHTML = '<div class="page page-dash"></div>';
  const page = el.firstElementChild;
  let editing = null;

  const goAccounts = (patch) => {
    store.setPrefs({ accounts: { search: '', cm: '', juriste: '', division: '', phase: '', statut: 'ouverts', sort: store.state.prefs.accounts?.sort || 'nom', ...patch } });
    ctx.navigate('comptes');
  };

  function noteCard(key, title, iconName, empty) {
    const text = store.state.settings[key] || '';
    if (editing === key) {
      return `<article class="card note-card editing" data-note="${key}">
        <header class="card-head"><h2>${icon(iconName)}${esc(title)}</h2></header>
        <textarea class="input textarea" rows="8" aria-label="${esc(title)}">${esc(text)}</textarea>
        <div class="pop-actions"><span class="muted small">Visible par toute l’équipe.</span><button class="btn btn-ghost btn-sm" data-act="cancel-note">Annuler</button><button class="btn btn-primary btn-sm" data-act="save-note">${icon('check')}<span>Enregistrer</span></button></div>
      </article>`;
    }
    return `<article class="card note-card" data-note="${key}">
      <header class="card-head"><h2>${icon(iconName)}${esc(title)}</h2><button class="btn btn-ghost btn-sm" data-act="edit-note">${icon('edit')}<span>Modifier</span></button></header>
      ${text ? `<div class="note-text">${esc(text).replace(/\n/g, '<br>')}</div>` : `<p class="muted">${esc(empty)}</p>`}
    </article>`;
  }

  function ring(pct) {
    const r = 52; const c = 2 * Math.PI * r;
    return `<div class="ring ring-xl" role="img" aria-label="${pct} % des dossiers signés"><svg viewBox="0 0 124 124" width="124" height="124"><circle cx="62" cy="62" r="${r}" class="ring-bg"/><circle cx="62" cy="62" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg><span class="ring-num">${pct}<small>%</small></span></div>`;
  }

  /** Histogramme des 15 étapes REPORT PAR DIV, colorées par phase. */
  function stepsChart(list) {
    const s = store.state.settings;
    const steps = listOptions(s, 'reportDiv');
    const counts = steps.map(() => 0);
    for (const c of list) { const i = stepIndex(s, c); if (i >= 0) counts[i]++; }
    const max = Math.max(1, ...counts);
    const groups = phases(s);
    return `<div class="steps-chart" role="list">
      ${groups.map((g) => `<div class="sc-phase" style="flex:${g.steps.length};--c:${esc(stageColor(g.stage))}">
        <div class="sc-bars">${g.steps.map(({ option, index }) => `<button type="button" class="sc-bar" role="listitem" data-phase="${g.stage}" data-tip="${esc(`${option.value} : ${counts[index]} dossier(s)`)}"><span class="sc-n">${counts[index] || ''}</span><span class="sc-fill" style="height:${counts[index] ? Math.max(4, (counts[index] / max) * 100) : 0}%"></span><span class="sc-x">${index + 1}</span></button>`).join('')}</div>
        <div class="sc-label">${esc(stageLabel(s, g.stage))}</div>
      </div>`).join('')}
    </div>`;
  }

  function render() {
    const s = store.state.settings;
    const list = store.state.list;
    const derived = store.state.derived;
    const k = kpis(s, list, derived, store.state.today);
    const year = s.season.year;
    const sig = k.signatureMilestone;
    const pct = Math.round(k.signedPct * 100);
    const accounts = groupAccounts(s, list, derived);
    const openAccounts = accounts.filter((a) => a.role !== 'ferme');
    const tracked = list.filter((c) => REPORT_STAGES.includes(derived.get(c.id)?.stage));

    // Par division (regroupements du reporting : MO (LCD/LED/LFD) → MO).
    const byDiv = new Map();
    for (const c of tracked) {
      const g = divisionGroup(s, c.values.division) || '—';
      if (!byDiv.has(g)) byDiv.set(g, { todo: 0, active: 0, signature: 0, done: 0, n: 0 });
      const x = byDiv.get(g); x[derived.get(c.id).stage]++; x.n++;
    }
    const divOrder = [...new Set(listOptions(s, 'division').map((o) => o.group || o.value))];
    const divRows = [...byDiv.entries()].sort((a, b) => (divOrder.indexOf(a[0]) + 1 || 99) - (divOrder.indexOf(b[0]) + 1 || 99));
    const divMax = Math.max(1, ...divRows.map(([, x]) => x.n));

    const team = workload(s, list, derived, 'cm').rows.filter((r) => r.actifs);
    const jur = workload(s, list, derived, 'juriste').rows.filter((r) => r.actifs);

    // Dossiers qui n'avancent plus (même étape depuis longtemps).
    const stuck = list.filter((c) => derived.get(c.id)?.stadeLevel).sort((a, b) => derived.get(b.id).joursStade - derived.get(a.id).joursStade);
    const recent = store.state.history.filter((h) => h.contractId || h.action === 'import').slice(0, 9);

    const start = list.length ? '' : `
      <section class="card start-card">
        <div class="start-text"><h2>${icon('sparkle')}Bienvenue dans le suivi de la saison ${esc(String(year))}</h2>
          <p class="muted">La base est vide. Importez votre classeur « Suivi CM » (.xlsx ou .xlsm) : les colonnes sont reconnues automatiquement, les CM et juristes sont créés. Les données sont ensuite partagées avec toute l’équipe.</p></div>
        <div class="btn-row"><button class="btn btn-primary" data-act="start-import">${icon('upload')}<span>Importer le fichier Suivi CM</span></button><button class="btn btn-ghost" data-act="start-demo">${icon('sparkle')}<span>Essayer avec des données fictives</span></button></div>
      </section>`;
    const links = (s.home?.links || []).filter((l) => l.label && l.url);

    page.innerHTML = `${start}
      <section class="dash-hero card">
        <div class="dh-main">
          <p class="hero-kicker">${esc(s.season.entity || 'Direction juridique')}</p>
          <h2 class="dh-title">Saison contractuelle ${esc(String(year))}</h2>
          <p class="dh-sub">${fmtNumber(openAccounts.length)} comptes clients suivis · ${fmtNumber(k.attendus)} dossiers (PAF / contrats) attendus · mis à jour en temps réel</p>
          <div class="dh-bar">${phaseBarHTML(s, k.byStage, { height: 14, labels: true })}</div>
          <div class="dh-legend">${REPORT_STAGES.map((st) => `<span><span class="ps-dot" style="--c:${esc(stageColor(st))}"></span>${esc(stageLabel(s, st))} <strong>${fmtNumber(k.byStage[st])}</strong></span>`).join('')}</div>
        </div>
        <div class="dh-ring">${ring(pct)}<span class="dh-ring-label"><strong>${fmtNumber(k.signes)}</strong> signés sur ${fmtNumber(k.attendus)}</span></div>
        <div class="dh-count" ${sig ? `data-tip="${esc(sig.label)}"` : ''}>
          <span class="hero-count-num">${sig ? esc(fmtCountdown(k.daysToSignature)) : '—'}</span>
          <span class="hero-count-label">${sig ? `avant la date butoir<br>du ${esc(fmtDate(sig.date, 'long'))}` : 'Date butoir non définie'}</span>
        </div>
      </section>

      <section class="phase-strip">
        ${REPORT_STAGES.map((st) => `<button class="ps-card" data-phase="${st}" style="--c:${esc(stageColor(st))}"><span class="ps-label"><span class="ps-dot"></span>${esc(stageLabel(s, st))}</span><span class="ps-num">${fmtNumber(k.byStage[st])}</span><span class="ps-sub">${k.attendus ? Math.round((k.byStage[st] / k.attendus) * 100) : 0} % des dossiers · voir les comptes ${icon('chevronRight')}</span></button>`).join('')}
      </section>

      <section class="card dash-card">
        <header class="card-head"><div><h2>Où en sont les dossiers ?</h2><p class="card-sub">Nombre de dossiers à chaque étape (REPORT PAR DIV), du premier contact à la clôture dans SELMS</p></div></header>
        ${stepsChart(tracked)}
      </section>

      <div class="dash-grid">
        <section class="card dash-card">
          <header class="card-head"><div><h2>Par division</h2><p class="card-sub">Dossiers par phase · cliquez pour voir les comptes</p></div><a class="link-btn" href="#/reporting">Reporting général${icon('chevronRight')}</a></header>
          <div class="div-bars">${divRows.map(([g, x]) => `<button type="button" class="db-row" data-div="${esc(g)}"><span class="db-name">${esc(g)}</span><span class="db-bar" style="width:${(x.n / divMax) * 100}%">${phaseBarHTML(s, x, { height: 18, labels: true })}</span><span class="db-val"><strong>${x.done}</strong>/${x.n}</span></button>`).join('') || '<p class="muted pad">Aucun dossier.</p>'}</div>
        </section>
        <section class="card dash-card">
          <header class="card-head"><div><h2>Équipe</h2><p class="card-sub">Dossiers actifs par contract manager et par juriste</p></div></header>
          <div class="team-cards">${team.map((r) => { const m = store.member(r.key); return `<button type="button" class="team-card" data-cm="${esc(r.key)}">${avatar(m || { name: r.label, color: '#8d9099' }, { size: 'md', title: false })}<span class="tc-main"><strong>${esc(r.label)}</strong><span class="muted small">${fmtNumber(r.actifs)} dossiers · ${r.pct === null ? '—' : `${Math.round(r.pct * 100)} % signés`}</span>${phaseBarHTML(s, { todo: r.attente, active: r.traitement, signature: r.signature, done: r.signes }, { height: 8 })}</span>${r.bloques ? `<span class="mini-badge warn" data-tip="Dossiers sans changement d’étape depuis ${s.alerts.blocageDays} j ou plus">${icon('clock')}${r.bloques}</span>` : ''}</button>`; }).join('')}</div>
          <div class="jur-list">${jur.map((r) => `<button type="button" class="jur-row" data-jur="${esc(r.key)}"><span class="jur-name">${esc(r.label)}</span>${phaseBarHTML(s, { todo: r.attente, active: r.traitement, signature: r.signature, done: r.signes }, { height: 8 })}<span class="muted small">${fmtNumber(r.actifs)}</span></button>`).join('')}</div>
        </section>
      </div>

      <div class="dash-grid">
        <section class="card dash-card">
          <header class="card-head"><div><h2>${icon('clock')}Dossiers à surveiller</h2><p class="card-sub">Même étape depuis ${s.alerts.vigilanceDays} jours ou plus (bloqué au-delà de ${s.alerts.blocageDays} j)</p></div><span class="count-pill">${stuck.length}</span></header>
          <ul class="watch-list">${stuck.slice(0, 8).map((c) => { const d = derived.get(c.id); const i = stepIndex(s, c); return `<li><a href="${accountHref(accountKey(c.values.client))}" class="watch-item"><span class="wi-days lvl-${d.stadeLevel}">${d.joursStade} j</span><span class="wi-main"><strong>${esc(c.values.client)}</strong><span class="muted small">${esc(c.values.division || '')} · ${esc(i >= 0 ? stepName(listOptions(s, 'reportDiv')[i].value) : '—')}</span></span>${icon('chevronRight')}</a></li>`; }).join('') || '<li class="muted small pad">Aucun dossier en attente prolongée.</li>'}</ul>
          ${stuck.length > 8 ? `<button class="link-btn" data-act="all-stuck">Voir les ${stuck.length} dossiers${icon('chevronRight')}</button>` : ''}
        </section>
        <section class="card dash-card">
          <header class="card-head"><div><h2>${icon('history')}Activité récente</h2><p class="card-sub">Les dernières modifications de l’équipe</p></div><a class="link-btn" href="#/journal">Journal${icon('chevronRight')}</a></header>
          <ul class="act-list">${recent.map((h) => { const c = store.getContract(h.contractId); const client = c?.values.client || (h.contractLabel || '').replace(/\s*\([^)]*\)$/, ''); const what = h.action === 'comment' ? `a commenté « ${h.to} »` : h.action === 'update' ? `${h.fieldLabel || h.field} → ${h.to || '—'}` : h.action === 'create' ? 'a créé une division' : (h.to || h.action); return `<li class="act-item"><div class="act-top">${client ? `<a class="act-client" href="${accountHref(accountKey(client))}">${esc(client)}</a>` : ''}${c?.values.division ? `<span class="mini-badge">${esc(c.values.division)}</span>` : ''}<span class="act-when muted" data-tip="${esc(fmtDateTime(h.ts))}">${esc(h.user || '')} · ${esc(fmtRelative(h.ts))}</span></div><div class="act-what">${esc(what)}</div></li>`; }).join('') || '<li class="muted small">Aucune activité pour l’instant.</li>'}</ul>
        </section>
      </div>

      <section class="dash-grid">
        ${noteCard('homeNotes', 'Dernières modifications', 'history', 'Notez ici les évolutions de la saison (nouveaux statuts, changements d’attribution…).')}
        ${noteCard('homeVigilance', 'Points de vigilance', 'alert', 'Notez ici les points d’attention par client (ex. « CARREFOUR PC & TA : mêmes conditions dans les 2 PAF »).')}
      </section>
      ${links.length ? `<section class="card links-card"><header class="card-head"><h2>${icon('link')}Liens utiles</h2></header><div class="links-row">${links.map((l) => `<a class="btn btn-secondary" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${esc(l.label)}</span></a>`).join('')}</div></section>` : ''}`;
    const ta = page.querySelector('.note-card.editing textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  page.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-phase],[data-div],[data-cm],[data-jur]');
    if (t) {
      if (t.dataset.phase) goAccounts({ phase: t.dataset.phase });
      else if (t.dataset.div) goAccounts({ division: t.dataset.div });
      else if (t.dataset.cm) goAccounts({ cm: t.dataset.cm });
      else if (t.dataset.jur) goAccounts({ juriste: t.dataset.jur });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    const card = e.target.closest('[data-note]');
    if (act === 'all-stuck') goAccounts({ sort: 'stade' });
    if (act === 'start-import') openImportDialog(ctx);
    if (act === 'start-demo') { await store.loadDemo(buildDemo); toast('Données fictives chargées.', { type: 'success' }); }
    if (act === 'edit-note') { editing = card.dataset.note; render(); }
    if (act === 'cancel-note') { editing = null; render(); }
    if (act === 'save-note') {
      const key = card.dataset.note;
      const text = card.querySelector('textarea').value.trim();
      editing = null;
      await store.saveSettings({ [key]: text }, key === 'homeNotes' ? 'Dernières modifications mises à jour' : 'Points de vigilance mis à jour');
      toast('Enregistré pour toute l’équipe.', { type: 'success', timeout: 2500 });
      render();
    }
  });
  page.addEventListener('keydown', (e) => {
    if (e.target.matches('.note-card textarea') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) page.querySelector('[data-act="save-note"]')?.click();
  });

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; if (!editing) render(); }); }; })();
  return { update(evt) { if (['data', 'settings', 'history'].includes(evt)) schedule(); } };
}
