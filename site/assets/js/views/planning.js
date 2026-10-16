// Échéancier : agenda des prochaines actions (en retard, cette semaine, semaine prochaine, plus tard)
// et calendrier de la saison (frise des jalons + diagramme de Gantt des négociations).

import { icon } from '../ui/icons.js';
import { avatar, calendarPopover, emptyState, milestoneMarks, optionChip } from '../ui/components.js';
import { menu, toast } from '../ui/overlay.js';
import { timelineHTML } from '../ui/charts.js';
import { filterBar } from './filterbar.js';
import { agenda, stageLabel } from '../core/compute.js';
import { STAGES } from '../core/schema.js';
import {
  addDays, diffDays, esc, fmtCountdown, fmtDate, isoToUTC, utcToISO,
} from '../core/utils.js';

export function mount(el, ctx) {
  const { store } = ctx;
  const fb = filterBar(ctx, { quick: true });
  el.innerHTML = '<div class="page page-planning"></div>';
  const page = el.firstElementChild;
  page.appendChild(fb.el);
  const body = document.createElement('div');
  body.className = 'planning';
  page.appendChild(body);

  function render() {
    const s = store.state.settings;
    const today = store.state.today;
    if (!store.state.list.length) { body.innerHTML = emptyState({ iconName: 'calendar', title: 'Aucun contrat', text: 'Les actions et échéances apparaîtront ici.' }); return; }
    const list = store.filtered();
    const derived = store.state.derived;
    const ag = agenda(s, list, derived, today);
    const bucket = (title, items, tone, hint) => `
      <section class="agenda-col tone-${tone}">
        <header><h3>${esc(title)}</h3><span class="kcol-count">${items.length}</span></header>
        ${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}
        <ul class="agenda-list">${items.map((it) => {
          const c = it.contract;
          return `<li class="agenda-item" data-open="${esc(c.id)}" tabindex="0">
            <div class="agenda-top"><span class="row-title">${esc(c.values.client || '')}</span><button class="icon-btn" data-postpone="${esc(c.id)}" aria-label="Reporter l’échéance" data-tip="Reporter">${icon('calendar')}</button>${avatar(store.member(c.values.cm))}</div>
            <div class="agenda-action">${esc(c.values.prochaineAction || 'Action à préciser')}</div>
            <div class="agenda-bottom"><span class="agenda-when${it.days < 0 ? ' late' : it.days <= 1 ? ' soon' : ''}">${icon('clock')}${esc(fmtDate(it.date, 'weekday'))} · ${esc(fmtCountdown(it.days))}</span>${optionChip(s, 'statut', c.values.statut, { cls: 'chip-sm' })}</div>
          </li>`;
        }).join('') || `<li class="agenda-empty">${icon('checkCircle')}<span>Rien à signaler</span></li>`}</ul>
      </section>`;

    body.innerHTML = `
      <section class="card timeline-card">${timelineHTML(s.milestones || [], today, { width: body.clientWidth - 80 })}</section>
      <div class="agenda">
        ${bucket('En retard', ag.overdue, 'late', '')}
        ${bucket('Cette semaine', ag.week, 'week', '')}
        ${bucket('Semaine prochaine', ag.next, 'next', '')}
        ${bucket('Plus tard', ag.later.slice(0, 30), 'later', ag.later.length > 30 ? `${ag.later.length - 30} autre(s) non affichée(s)` : '')}
      </div>
      ${ag.undated ? `<div class="callout">${icon('info')}<div><strong>${ag.undated} contrat(s) en cours sans échéance.</strong> Renseignez une « Échéance » pour qu’ils apparaissent dans l’agenda. <button class="link-btn" data-act="no-date">Les afficher</button></div></div>` : ''}
      <section class="card gantt-card">
        <header class="card-head"><div><h2>Calendrier des négociations</h2><p class="card-sub">De l’envoi des CGV à la signature · ${list.length} contrat(s)</p></div>
          <div class="legend">${STAGES.filter((x) => x.id !== 'cancelled' && x.id !== 'todo').map((x) => `<span class="legend-item"><span class="legend-swatch" style="--c:${x.color}"></span>${esc(x.id === 'done' ? 'Signé' : x.id === 'blocked' ? 'Bloqué' : 'Négociation en cours')}</span>`).join('')}<span class="legend-item"><span class="legend-dash"></span>CGV à envoyer</span><span class="legend-item"><span class="legend-diamond"></span>Prochaine échéance</span></div>
        </header>
        ${gantt(list)}
      </section>`;
  }

  function gantt(list) {
    const s = store.state.settings;
    const today = store.state.today;
    const derived = store.state.derived;
    const ms = (s.milestones || []).filter((m) => m.date);
    const dates = [today, ...ms.map((m) => m.date)];
    for (const c of list) for (const k of ['dateCgv', 'dateSignature', 'echeance']) if (c.values[k]) dates.push(c.values[k]);
    dates.sort();
    const start = addDays(dates[0], -7);
    const end = addDays(dates[dates.length - 1], 10);
    const span = Math.max(1, diffDays(start, end));
    const pct = (iso) => `${((diffDays(start, iso) / span) * 100).toFixed(3)}%`;
    const months = [];
    const d0 = new Date(isoToUTC(start));
    let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
    while (cur <= isoToUTC(end)) { months.push(utcToISO(cur)); const d = new Date(cur); cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
    const rows = list.slice().sort((a, b) => String(a.values.dateCgv || '9999').localeCompare(String(b.values.dateCgv || '9999')) || String(a.values.ref).localeCompare(String(b.values.ref), 'fr', { numeric: true }));
    const lines = `${months.map((m) => `<span class="g-month" style="left:${pct(m)}"></span>`).join('')}
      ${ms.map((m) => `<span class="g-ms${m.role ? ` role-${esc(m.role)}` : ''}" style="left:${pct(m.date)}"></span>`).join('')}
      <span class="g-today" style="left:${pct(today)}"></span>`;
    const headLines = `${months.map((m) => `<span class="g-month" style="left:${pct(m)}"><span>${esc(fmtDate(m, 'monthShort'))} ${m.slice(2, 4)}</span></span>`).join('')}
      ${ms.map((m) => `<span class="g-ms${m.role ? ` role-${esc(m.role)}` : ''}" style="left:${pct(m.date)}" data-tip="${esc(`${m.label} — ${fmtDate(m.date, 'long')}`)}"></span>`).join('')}
      <span class="g-today" style="left:${pct(today)}" data-tip="Aujourd’hui"></span>`;
    const cgvMs = ms.find((m) => m.role === 'cgv');
    return `<div class="gantt" role="table" aria-label="Calendrier des négociations">
      <div class="g-row g-head" role="row"><div class="g-label" role="columnheader">Contrat</div><div class="g-track" role="columnheader">${headLines}${ms.filter((m) => m.role).map((m) => `<span class="g-ms-label" style="left:${pct(m.date)}">${esc(m.role === 'cgv' ? 'CGV' : m.role === 'signature' ? 'Butoir' : 'Objectif')}</span>`).join('')}</div></div>
      ${rows.map((c) => {
        const v = c.values;
        const d = derived.get(c.id);
        const stage = d?.stage || 'todo';
        const st = STAGES.find((x) => x.id === stage);
        let bar = '';
        if (v.dateCgv) {
          const to = v.dateSignature && stage === 'done' ? v.dateSignature : today > v.dateCgv ? today : addDays(v.dateCgv, 1);
          const tip = `${v.client} — ${stageLabel(stage)} · CGV ${fmtDate(v.dateCgv)}${v.dateSignature ? ` · signé le ${fmtDate(v.dateSignature)}` : ''} · ${diffDays(v.dateCgv, to)} j`;
          bar = `<span class="g-bar stage-${stage}" style="left:${pct(v.dateCgv)};width:calc(${pct(to)} - ${pct(v.dateCgv)});--c:${st.color}" data-tip="${esc(tip)}"></span>`;
        } else if (stage === 'done' && v.dateSignature) {
          bar = `<span class="g-dot stage-done" style="left:${pct(v.dateSignature)}" data-tip="${esc(`Signé le ${fmtDate(v.dateSignature)}`)}"></span>`;
        }
        const due = v.echeance && stage !== 'done' && stage !== 'cancelled' ? `<span class="g-due${v.echeance < today ? ' late' : ''}" style="left:${pct(v.echeance)}" data-tip="${esc(`${v.prochaineAction || 'Échéance'} — ${fmtDate(v.echeance)}`)}"></span>` : '';
        return `<div class="g-row" role="row" data-open="${esc(c.id)}">
          <div class="g-label" role="cell"><span class="clip">${esc(v.client || '')}</span><span class="g-ref">${esc(v.ref || '')}</span></div>
          <div class="g-track" role="cell">${lines}${bar}${due}${!v.dateCgv && stage !== 'done' && stage !== 'cancelled' && cgvMs && cgvMs.date > today ? `<span class="g-pending" style="left:${pct(today)};width:calc(${pct(cgvMs.date)} - ${pct(today)})" data-tip="${esc(`${v.client} — CGV à envoyer avant le ${fmtDate(cgvMs.date)}`)}"></span>` : ''}${!v.dateCgv && stage !== 'done' && stage !== 'cancelled' && (!cgvMs || cgvMs.date <= today) ? `<span class="g-pending late" style="left:${pct(cgvMs ? cgvMs.date : today)};width:calc(${pct(today)} - ${pct(cgvMs ? cgvMs.date : today)})" data-tip="${esc(`${v.client} — CGV non envoyées`)}"></span>` : ''}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  body.addEventListener('click', (e) => {
    const pp = e.target.closest('[data-postpone]');
    if (pp) { e.stopPropagation(); postpone(pp, pp.dataset.postpone); return; }
    if (e.target.closest('[data-act="no-date"]')) { store.setFilters({ quick: 'active' }); ctx.navigate('suivi'); store.setPrefs({ sort: [{ key: 'echeance', dir: 1 }] }); return; }
    const o = e.target.closest('[data-open]');
    if (o) ctx.openContract(o.dataset.open);
  });
  body.addEventListener('keydown', (e) => {
    const o = e.target.closest('.agenda-item');
    if (o && e.key === 'Enter') ctx.openContract(o.dataset.open);
  });

  function postpone(anchor, id) {
    const c = store.getContract(id);
    if (!c) return;
    const base = c.values.echeance && c.values.echeance > store.state.today ? c.values.echeance : store.state.today;
    const set = async (iso) => {
      await store.updateField(id, 'echeance', iso);
      toast(`Échéance reportée au ${fmtDate(iso)}.`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
    };
    menu(anchor, [
      { header: `Reporter « ${c.values.client} »` },
      { label: 'Demain', onClick: () => set(addDays(store.state.today, 1)) },
      { label: '+ 3 jours', onClick: () => set(addDays(base, 3)) },
      { label: '+ 1 semaine', onClick: () => set(addDays(base, 7)) },
      { label: '+ 2 semaines', onClick: () => set(addDays(base, 14)) },
      { label: 'Choisir une date…', icon: 'calendar', onClick: () => calendarPopover(anchor, { value: c.values.echeance, title: 'Nouvelle échéance', marks: milestoneMarks(store.state.settings), onPick: (v) => { if (v) set(v); } }) },
    ], { placement: 'bottom-end' });
  }

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; render(); }); }; })();
  return {
    update(evt) {
      if (evt === 'data' || evt === 'settings') schedule();
      if (evt === 'prefs') { fb.update(); schedule(); }
    },
  };
}
