// Tableau de bord : compte à rebours, jauges CGV et signatures, frise de la saison,
// indicateurs, pipeline par statut, avancement par dimension, rythme de signature,
// alertes prioritaires, échéances proches et activité récente.

import { icon } from '../ui/icons.js';
import { avatar, emptyState, levelIcon, optionChip } from '../ui/components.js';
import {
  barListHTML, bindMarkTips, fitSegmentLabels, renderBurnup, stackedHTML, timelineHTML,
} from '../ui/charts.js';
import { filterBar, filtersActive } from './filterbar.js';
import {
  agenda, breakdown, byStatus, kpis, LEVEL_RANK, signatureSeries,
} from '../core/compute.js';
import { columnByKey, STAGES, STAGE_ORDER_FOR_BARS } from '../core/schema.js';
import { buildDemo } from '../core/demo.js';
import {
  addDays, debounce, esc, fmtCountdown, fmtDate, fmtMoneyK, fmtNumber, fmtPct, fmtRelative, pluralize,
} from '../core/utils.js';

const DIMS = [
  { key: 'cm', label: 'Contract manager' },
  { key: 'division', label: 'Division' },
  { key: 'canal', label: 'Canal' },
  { key: 'priorite', label: 'Priorité' },
  { key: 'typeContrat', label: 'Type' },
];

export function mount(el, ctx) {
  const { store } = ctx;
  const fb = filterBar(ctx, { quick: false });
  el.innerHTML = '<div class="page page-dashboard"></div>';
  const page = el.firstElementChild;
  page.appendChild(fb.el);
  const body = document.createElement('div');
  body.className = 'dash';
  page.appendChild(body);
  bindMarkTips(body);

  const isDark = () => document.documentElement.dataset.theme === 'dark';
  const segColors = () => STAGE_ORDER_FOR_BARS.map((id) => {
    const s = STAGES.find((x) => x.id === id);
    return { key: id, label: s.label, color: isDark() ? s.darkColor : s.color };
  });

  function render() {
    const s = store.state.settings;
    const today = store.state.today;
    const all = store.state.list;
    if (!all.length) {
      body.innerHTML = emptyState({
        iconName: 'sheet',
        title: 'Aucun contrat pour l’instant',
        text: 'Importez votre fichier de suivi Excel, créez votre premier contrat ou chargez des données de démonstration pour découvrir l’outil.',
        actions: `<button class="btn btn-primary" data-act="import">${icon('upload')}<span>Importer un fichier Excel</span></button><button class="btn btn-secondary" data-act="new">${icon('plus')}<span>Nouveau contrat</span></button><button class="btn btn-ghost" data-act="demo">${icon('sparkle')}<span>Données de démonstration</span></button>`,
      });
      return;
    }
    const list = store.filtered();
    const derived = store.state.derived;
    const k = kpis(s, list, derived, today);
    const scoped = filtersActive(store);
    const sig = k.signatureMilestone;
    const cgv = k.cgvMilestone;
    const dimKey = DIMS.some((d) => d.key === store.state.prefs.dashboardDim && columnByKey(s, d.key)) ? store.state.prefs.dashboardDim : 'cm';
    const dimLabel = DIMS.find((d) => d.key === dimKey)?.label;

    // Héros : compte à rebours vers la date butoir.
    let heroNum = '—'; let heroText = 'Aucune date butoir définie (Paramètres › Saison).';
    if (sig) {
      const d = k.daysToSignature;
      heroNum = d >= 0 ? `J-${d}` : `J+${-d}`;
      heroText = d > 0 ? `avant la date butoir de signature du ${fmtDate(sig.date, 'long')}` : d === 0 ? `Date butoir aujourd’hui (${fmtDate(sig.date, 'long')})` : `après la date butoir du ${fmtDate(sig.date, 'long')}`;
    }
    const nextMs = (s.milestones || []).filter((m) => m.date && m.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0];

    const meter = (label, num, den, pct, tone, extra = '') => `
      <div class="hero-meter">
        <div class="hero-meter-top"><span>${esc(label)}</span><strong>${fmtPct(pct)}</strong></div>
        <div class="meter meter-lg tone-${tone}" role="img" aria-label="${esc(label)} : ${num} sur ${den}"><span class="meter-fill" style="width:${Math.round(pct * 100)}%"></span></div>
        <div class="hero-meter-foot"><strong>${fmtNumber(num)}</strong> sur ${fmtNumber(den)}${extra}</div>
      </div>`;

    const statusRows = byStatus(s, list).map((r) => ({
      key: r.value, label: r.value, value: r.count, color: r.color,
      sub: r.ca ? fmtMoneyK(r.ca) : '', subLabel: 'CA N-1 cumulé',
    }));
    const groups = breakdown(s, list, derived, dimKey);
    const series = signatureSeries(s, list, derived, today);
    const ag = agenda(s, list, derived, today);
    const soon = [...ag.overdue, ...ag.week, ...ag.next].filter((x) => x.date <= addDays(today, 14)).slice(0, 8);
    const alerts = list
      .map((c) => ({ c, d: derived.get(c.id) }))
      .filter(({ d }) => d.alerts.some((a) => a.level === 'critical' || a.level === 'serious'))
      .sort((a, b) => LEVEL_RANK[b.d.level] - LEVEL_RANK[a.d.level] || (Number(b.c.values.ca) || 0) - (Number(a.c.values.ca) || 0))
      .slice(0, 8);
    const activity = store.state.history.slice(0, 9);

    body.innerHTML = `
      ${scoped ? `<div class="scope-note">${icon('filter')}<span>Indicateurs calculés sur <strong>${pluralize(list.length, 'contrat filtré', 'contrats filtrés')}</strong> (sur ${all.length}).</span></div>` : ''}
      <section class="hero card">
        <div class="hero-count">
          <div class="hero-num">${esc(heroNum)}</div>
          <div class="hero-text">${esc(heroText)}</div>
          ${nextMs && nextMs.date !== sig?.date ? `<div class="hero-next">${icon('flag')}<span>Prochain jalon : <strong>${esc(nextMs.label)}</strong> le ${esc(fmtDate(nextMs.date, 'long'))} (${esc(fmtCountdown(Math.round((Date.parse(nextMs.date) - Date.parse(today)) / 86400000)))})</span></div>` : ''}
        </div>
        <div class="hero-meters">
          ${cgv ? meter('CGV envoyées', k.cgvSent, k.live, k.cgvPct, 'brand', ` · échéance ${fmtDate(cgv.date, 'dm')}`) : ''}
          ${meter('Conventions signées', k.signed, k.live, k.signedPct, 'good')}
          ${k.caTotal ? meter('CA N-1 signé', Math.round(k.caSigned), Math.round(k.caTotal), k.caSignedPct, 'good', ' k€') : ''}
        </div>
      </section>

      <section class="card timeline-card">${timelineHTML(s.milestones || [], today, { width: body.clientWidth - 80 })}</section>

      <section class="kpis">
        ${tile('Contrats suivis', k.live, k.cancelled ? `${k.cancelled} abandonné(s) exclu(s)` : `${fmtMoneyK(k.caTotal) || '0 k€'} de CA N-1`, 'table', '')}
        ${tile('En cours', k.active, `${k.todo} à lancer`, 'refresh', 'active')}
        ${tile('Signés', k.signed, fmtPct(k.signedPct), 'checkCircle', 'signed', 'good')}
        ${tile('Bloqués', k.blocked, k.blocked ? 'escalade nécessaire' : 'aucun blocage', 'pause', 'blocked', k.blocked ? 'critical' : '')}
        ${tile('Alertes critiques', k.critical, `${k.serious} importante(s)`, 'alertCircle', 'alerts', k.critical ? 'critical' : '')}
        ${tile('Actions en retard', k.overdueActions, `${k.dueSoon} à échéance proche`, 'clock', 'late', k.overdueActions ? 'serious' : '')}
      </section>

      <div class="dash-grid two">
        <section class="card">
          <header class="card-head"><div><h2>Pipeline par statut</h2><p class="card-sub">Nombre de contrats et CA N-1 par étape</p></div><a class="link-btn" href="#/pipeline">Voir le pipeline${icon('chevronRight')}</a></header>
          <div class="status-bars">${barListHTML(statusRows, { tipLabel: 'contrats' })}</div>
        </section>
        <section class="card">
          <header class="card-head"><div><h2>Avancement par ${esc(dimLabel.toLowerCase())}</h2><p class="card-sub">Contrats signés, en cours, à lancer et bloqués</p></div></header>
          <div class="card-tools"><div class="seg-ctrl" role="tablist" aria-label="Dimension">${DIMS.filter((d) => columnByKey(s, d.key)).map((d) => `<button role="tab" class="${d.key === dimKey ? 'active' : ''}" aria-selected="${d.key === dimKey}" data-dim="${d.key}">${esc(d.label)}</button>`).join('')}</div></div>
          <div class="stack-wrap">${stackedHTML(groups.map((g) => ({ ...g, label: g.label })), segColors())}</div>
        </section>
      </div>

      <section class="card">
        <header class="card-head"><div><h2>Rythme de signature</h2><p class="card-sub">Signatures cumulées comparées à une trajectoire régulière jusqu’à la date butoir${series.undated ? ` · ${series.undated} contrat(s) signé(s) sans date de signature` : ''}</p></div></header>
        <div class="burnup-wrap" id="burnup"></div>
      </section>

      <div class="dash-grid three">
        <section class="card list-card">
          <header class="card-head"><div><h2>Alertes prioritaires</h2><p class="card-sub">Critiques et importantes</p></div><a class="link-btn" href="#/suivi" data-quick="alerts">Tout voir${icon('chevronRight')}</a></header>
          ${alerts.length ? `<ul class="rows">${alerts.map(({ c, d }) => `
            <li><button class="row-btn" data-open="${esc(c.id)}">${levelIcon(d.level)}
              <span class="row-main"><span class="row-title">${esc(c.values.client || '')}</span><span class="row-sub">${esc(d.alerts[0].label)}</span></span>
              ${avatar(store.member(c.values.cm))}
            </button></li>`).join('')}</ul>` : `<div class="mini-empty">${icon('checkCircle')}<span>Aucune alerte critique ou importante.</span></div>`}
        </section>
        <section class="card list-card">
          <header class="card-head"><div><h2>Échéances à 14 jours</h2><p class="card-sub">${ag.overdue.length ? `${ag.overdue.length} action(s) en retard` : 'Prochaines actions planifiées'}</p></div><a class="link-btn" href="#/echeancier">Échéancier${icon('chevronRight')}</a></header>
          ${soon.length ? `<ul class="rows">${soon.map((it) => `
            <li><button class="row-btn" data-open="${esc(it.contract.id)}">
              <span class="due ${it.days < 0 ? 'late' : it.days <= 2 ? 'soon' : ''}"><strong>${esc(fmtDate(it.date, 'dm'))}</strong><span>${esc(fmtCountdown(it.days))}</span></span>
              <span class="row-main"><span class="row-title">${esc(it.contract.values.client || '')}</span><span class="row-sub">${esc(it.contract.values.prochaineAction || 'Action à préciser')}</span></span>
              ${avatar(store.member(it.contract.values.cm))}
            </button></li>`).join('')}</ul>` : `<div class="mini-empty">${icon('calendar')}<span>Aucune échéance dans les 14 prochains jours.</span></div>`}
        </section>
        <section class="card list-card">
          <header class="card-head"><div><h2>Activité récente</h2><p class="card-sub">Dernières modifications de l’équipe</p></div><a class="link-btn" href="#/journal">Journal${icon('chevronRight')}</a></header>
          ${activity.length ? `<ul class="rows feed">${activity.map((h) => `
            <li><button class="row-btn" ${h.contractId && store.getContract(h.contractId) ? `data-open="${esc(h.contractId)}"` : 'disabled'}>
              ${avatar({ name: h.user, color: (s.team || []).find((t) => t.name === h.user)?.color || '#8d9099' })}
              <span class="row-main"><span class="row-title">${esc(activityText(h))}</span><span class="row-sub">${esc(h.contractLabel || '')}${h.contractLabel ? ' · ' : ''}${esc(fmtRelative(h.ts))}</span></span>
            </button></li>`).join('')}</ul>` : `<div class="mini-empty">${icon('history')}<span>Aucune activité pour l’instant.</span></div>`}
        </section>
      </div>`;

    const burn = body.querySelector('#burnup');
    const draw = () => renderBurnup(burn, series, {
      today,
      marks: (s.milestones || []).filter((m) => m.role).map((m) => ({ date: m.date, label: shortMs(m) })),
      colors: { actual: isDark() ? '#3fbf3f' : '#0a8a0a', target: isDark() ? '#8d9099' : '#9a9da5' },
    });
    draw();
    fitSegmentLabels(body);
    lastDraw = draw;
  }

  function shortMs(m) {
    if (m.role === 'cgv') return 'CGV';
    if (m.role === 'signature') return 'Date butoir';
    if (m.role === 'target') return 'Objectif interne';
    return m.label;
  }

  function tile(label, value, sub, ic, quick, tone = '') {
    return `<a class="kpi card ${tone ? `tone-${tone}` : ''}" href="#/suivi" data-quick="${esc(quick)}">
      <span class="kpi-ico">${icon(ic)}</span>
      <span class="kpi-label">${esc(label)}</span>
      <span class="kpi-value">${fmtNumber(value)}</span>
      <span class="kpi-sub">${esc(sub)}</span>
    </a>`;
  }

  let lastDraw = null;
  body.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { ctx.openContract(open.dataset.open); return; }
    const q = e.target.closest('[data-quick]');
    if (q) { store.setFilters({ quick: q.dataset.quick || '' }); return; }
    const dim = e.target.closest('[data-dim]');
    if (dim) { store.setPrefs({ dashboardDim: dim.dataset.dim }); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') ctx.newContract();
    if (act === 'import') ctx.navigate('parametres/donnees');
    if (act === 'demo') { await store.loadDemo(buildDemo); }
  });

  const ro = new ResizeObserver(debounce(() => { lastDraw?.(); fitSegmentLabels(body); }, 120));
  ro.observe(body);
  render();

  return {
    update(evt) {
      if (evt === 'data' || evt === 'history' || evt === 'settings') schedule();
      if (evt === 'prefs') { fb.update(); schedule(); }
    },
    unmount() { ro.disconnect(); },
  };

  function schedule() {
    if (schedule.t) return;
    schedule.t = requestAnimationFrame(() => { schedule.t = null; render(); });
  }
}

export function activityText(h) {
  switch (h.action) {
    case 'update': return `${h.user} · ${h.fieldLabel || h.field} → ${h.to || '∅'}`;
    case 'create': return `${h.user} a créé le contrat`;
    case 'delete': return `${h.user} a supprimé le contrat`;
    case 'restore': return `${h.user} a restauré le contrat`;
    case 'comment': return `${h.user} a commenté : ${h.to || ''}`;
    case 'mail': return `${h.user} a préparé une relance`;
    case 'import': return `${h.user} · ${h.to || 'import'}`;
    case 'settings': return `${h.user} a modifié les paramètres (${h.fieldLabel || ''})`;
    case 'restore-all': return `${h.user} · ${h.to || 'restauration'}`;
    default: return `${h.user} · ${h.action}`;
  }
}
