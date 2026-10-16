// Fiche d'un compte client : toutes ses divisions, leur étape (REPORT PAR DIV) sur une barre de progression,
// l'équipe, les jalons et les notes, les informations propres au client (saisies une fois pour toutes ses
// divisions), les échanges de l'équipe et l'activité récente.

import { icon } from '../ui/icons.js';
import { avatar, calendarPopover, emptyState, fieldControl, milestoneMarks, optionColor, optionPicker, stageColor } from '../ui/components.js';
import { confirmDialog, menu, promptDialog, toast } from '../ui/overlay.js';
import { phaseBadge, stepPicker, trackHTML } from '../ui/steps.js';
import { accountHref } from './accounts.js';
import { accountKey, clientValue, groupAccounts, stepInfo } from '../core/compute.js';
import { CLIENT_FIELDS, columnByKey, DIVISION_SECTIONS, listOptions, stageLabel, stepName } from '../core/schema.js';
import { esc, fmtDate, fmtDateTime, fmtNumber, fmtRelative } from '../core/utils.js';

const CLIENT_GROUPS = [
  { label: 'Identification', keys: ['activite', 'codeGerp', 'entiteSignataire', 'top30', 'independant', 'centraleRef', 'accordInternational'] },
  { label: 'Identité juridique', keys: ['formeSociale', 'capital', 'rcs', 'villeRcs', 'siege', 'codePostal', 'ville'] },
  { label: '', keys: ['commentairesBase'], wide: true },
];
const MAIN_FIELDS = ['statutCompte', 'cm', 'juriste', 'attribution2027', 'kam'];
const JALON_KEYS = ['receptionCc', 'revueAttribuee', 'revueTerminee', 'approvalLancee', 'approvalTerminee', 'miseEnSignature', 'signatureClient', 'signatureSef'];
const SHORT = {
  statutCompte: 'Statut du compte', attribution2027: 'Attribution 2027', receptionCc: 'Réception CC', revueAttribuee: 'Revue attribuée', revueTerminee: 'Revue terminée',
  approvalLancee: 'Approval lancée', approvalTerminee: 'Approval terminée', miseEnSignature: 'Mise en signature', signatureClient: 'Signature client', signatureSef: 'Signature SEF',
};

export function mount(el, ctx, { sub } = {}) {
  const { store } = ctx;
  let key = decodeURIComponent(sub || '');
  el.innerHTML = '<div class="page page-account"></div>';
  const page = el.firstElementChild;
  let dirty = false;
  let openMore = new Set();

  const account = () => groupAccounts(store.state.settings, store.state.list, store.state.derived).find((a) => a.key === key) || null;
  const col = (k) => columnByKey(store.state.settings, k);

  function ring(pct, label) {
    const r = 34; const c = 2 * Math.PI * r;
    return `<div class="ring" role="img" aria-label="${esc(`${pct} % ${label}`)}"><svg viewBox="0 0 84 84" width="84" height="84"><circle cx="42" cy="42" r="${r}" class="ring-bg"/><circle cx="42" cy="42" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/></svg><span class="ring-num">${pct}<small>%</small></span></div>`;
  }

  function historyLine(h) {
    const what = h.action === 'comment' ? `a commenté : « ${h.to} »`
      : h.action === 'create' ? 'a créé la division' : h.action === 'delete' ? 'a supprimé la division'
        : h.action === 'update' ? `${h.fieldLabel || h.field} : ${h.from || '—'} → ${h.to || '—'}` : (h.to || h.action);
    const div = store.getContract(h.contractId)?.values.division || (h.contractLabel || '').match(/\(([^)]*)\)$/)?.[1] || '';
    return `<li class="act-item"><div class="act-top"><span class="act-who">${esc(h.user || 'Quelqu’un')}</span>${div ? `<span class="mini-badge">${esc(div)}</span>` : ''}<span class="act-when muted" data-tip="${esc(fmtDateTime(h.ts))}">${esc(fmtRelative(h.ts))}</span></div><div class="act-what">${esc(what)}</div></li>`;
  }

  function divisionCard(c) {
    const s = store.state.settings;
    const d = store.state.derived.get(c.id) || {};
    const info = stepInfo(s, c);
    const divColor = optionColor(s, 'division', c.values.division);
    const alerts = (d.alerts || []).filter((x) => x.level !== 'info');
    const since = d.joursStade !== null && d.joursStade !== undefined && info.stage !== 'done'
      ? `<span class="since ${d.stadeLevel ? `lvl-${d.stadeLevel}` : ''}" data-tip="Depuis le dernier changement d’étape ou le dernier jalon daté">${icon('clock')}${d.joursStade} j à cette étape</span>` : '';
    return `<article class="card dv-card${d.closed ? ' is-closed' : ''}" data-id="${esc(c.id)}" style="--dv:${esc(divColor)}">
      <header class="dv-head">
        <button type="button" class="dv-code" data-act="division" data-tip="Changer la division">${esc(c.values.division || '?')}</button>
        <div class="dv-step">
          <button type="button" class="dv-step-btn" data-act="step" aria-haspopup="listbox">
            <span class="dv-step-num">${info.index >= 0 ? `Étape ${info.index + 1}/${info.count}` : 'Étape'}</span>
            <strong>${esc(info.name)}</strong>${icon('chevronDown')}</button>
          <div class="dv-step-meta">${info.index >= 0 ? phaseBadge(s, info.stage) : ''}${info.option?.gen ? `<span class="muted small" data-tip="REPORT GEN, déduit automatiquement de l’étape">GEN : ${esc(info.option.gen)}</span>` : ''}${since}</div>
        </div>
        <button type="button" class="icon-btn" data-act="more" aria-label="Actions sur la division ${esc(c.values.division || '')}">${icon('more')}</button>
      </header>
      ${trackHTML(s, c, { size: 'lg', interactive: !d.closed, closed: d.closed })}
      ${alerts.length ? `<ul class="dv-alerts">${alerts.map((a) => `<li class="lvl-${a.level}">${icon(a.level === 'warning' ? 'clock' : 'alert')}${esc(a.label)}</li>`).join('')}</ul>` : ''}
      <div class="dv-fields">${MAIN_FIELDS.filter((k) => col(k)).map((k) => `<div class="dv-field"><span class="field-label">${esc(SHORT[k] || col(k).label)}</span><span class="slot" data-slot="${k}"></span></div>`).join('')}</div>
      <div class="dv-jalons" role="group" aria-label="Jalons du dossier">${JALON_KEYS.filter((k) => col(k)).map((k) => `<button type="button" class="jl-item${c.values[k] ? ' set' : ''}${d.badJalons?.includes(k) ? ' bad' : ''}${d.futureJalons?.includes(k) ? ' future' : ''}" data-jalon="${k}" data-tip="${esc(`${col(k).label}${d.badJalons?.includes(k) ? ' — date incohérente avec les jalons précédents' : ''}`)}"><span class="jl-dot"></span><span class="jl-label">${esc(SHORT[k] || col(k).label)}</span><span class="jl-date">${c.values[k] ? esc(fmtDate(c.values[k])) : 'Ajouter'}</span></button>`).join('')}</div>
      <div class="dv-note"><span class="field-label">Suivi du CM</span><span class="slot" data-slot="suiviCm"></span></div>
      <details class="dv-more" ${openMore.has(c.id) ? 'open' : ''}><summary>${icon('chevronRight')}Plus d’informations : dossier, contrat, signature, saison ${esc(String(Number(s.season.year) - 1))}</summary>
        ${DIVISION_SECTIONS.filter((sec) => sec.id !== 'jalons').map((sec) => `<section class="dv-sec"><h4>${esc(sec.label)}</h4><div class="dv-grid">${sec.keys.filter((k) => col(k) && !MAIN_FIELDS.includes(k)).map((k) => `<div class="dv-field${col(k).type === 'longtext' ? ' wide' : ''}"><span class="field-label">${esc(col(k).label)}</span><span class="slot" data-slot="${k}"></span></div>`).join('')}</div></section>`).join('')}
      </details>
    </article>`;
  }

  function render() {
    dirty = false;
    const s = store.state.settings;
    const a = account();
    if (!a) {
      page.innerHTML = store.state.loaded.contracts || store.state.list.length
        ? emptyState({ iconName: 'users', title: 'Compte introuvable', text: 'Ce compte a peut-être été renommé ou supprimé.', actions: `<a class="btn btn-primary" href="#/comptes">${icon('arrowLeft')}<span>Retour aux comptes</span></a>` })
        : '<div class="boot"><div class="boot-spinner"></div></div>';
      return;
    }
    document.title = `${a.client} · ${s.season.name}`;
    const ids = new Set(a.rows.map((c) => c.id));
    const cms = a.cms.map((id) => store.member(id)).filter(Boolean);
    const role = listOptions(s, 'statutCompte').find((o) => o.role === a.role);
    const comments = store.state.comments.filter((x) => ids.has(x.contractId)).sort((x, y) => y.ts - x.ts);
    const history = store.state.history.filter((h) => ids.has(h.contractId)).slice(0, 12);
    const least = a.minStep !== null && a.minStep !== undefined ? listOptions(s, 'reportDiv')[a.minStep] : null;
    const sub = [clientValue(a.rows, 'activite'), clientValue(a.rows, 'codeGerp') ? `GERP ${clientValue(a.rows, 'codeGerp')}` : '', clientValue(a.rows, 'entiteSignataire')].filter(Boolean);
    const divOrder = a.rows;
    page.innerHTML = `
      <a class="back-link" href="#/comptes">${icon('arrowLeft')}Comptes clients</a>
      <section class="card acc-hero">
        <div class="ah-main">
          <div class="ah-title"><h2>${esc(a.client)}</h2><button class="icon-btn" data-act="rename" aria-label="Renommer le client" data-tip="Renommer le client">${icon('edit')}</button></div>
          <div class="ah-badges">
            ${role ? `<span class="mini-badge" style="--c:${esc(role.color)}">${esc(a.role === 'ferme' ? 'Compte fermé' : role.value)}</span>` : ''}
            ${a.flags.top30 ? '<span class="mini-badge brand">TOP 30</span>' : ''}${a.flags.independant ? '<span class="mini-badge">Indépendant</span>' : ''}
            ${a.flags.centraleRef ? '<span class="mini-badge">Centrale de référencement</span>' : ''}${a.flags.accordInternational ? '<span class="mini-badge">Accord international</span>' : ''}
          </div>
          ${sub.length ? `<p class="ah-sub">${sub.map(esc).join(' · ')}</p>` : ''}
        </div>
        <div class="ah-stats">
          <div class="ah-stat">${ring(a.progress, 'd’avancement moyen')}<span class="ah-stat-label">Avancement moyen<br>des divisions</span></div>
          <div class="ah-stat"><span class="ah-big">${a.signed}<small> / ${a.total}</small></span><span class="ah-stat-label">division${a.total > 1 ? 's' : ''}<br>signée${a.total > 1 ? 's' : ''}</span></div>
          <div class="ah-stat"><span class="ah-team">${cms.length ? cms.map((m) => avatar(m, { size: 'md' })).join('') : avatar(null, { size: 'md' })}</span><span class="ah-stat-label">${esc(cms.map((m) => m.name).join(', ') || 'CM à attribuer')}<br><span class="muted">${esc(a.juristes.join(', ') || 'Juriste à attribuer')}</span></span></div>
          ${least ? `<div class="ah-stat"><span class="phase-dot" style="--c:${esc(stageColor(store.state.derived.get(a.tracked.find((c) => c.values.reportDiv === least.value)?.id)?.stage || 'active'))}"></span><span class="ah-stat-label">Division la moins avancée<br><strong>${esc(stepName(least.value))}</strong></span></div>` : ''}
        </div>
      </section>
      <div class="acc-layout">
        <div class="acc-main">
          <div class="section-head"><h3>Divisions <span class="muted">${a.rows.length}</span></h3><button class="btn btn-secondary btn-sm" data-act="add-div">${icon('plus')}<span>Ajouter une division</span></button></div>
          ${divOrder.map(divisionCard).join('')}
        </div>
        <aside class="acc-side">
          <section class="card side-card">
            <header class="card-head"><h2>${icon('building')}Client</h2><span class="muted small">Commun à toutes les divisions</span></header>
            ${CLIENT_GROUPS.map((g) => `<div class="cf-group">${g.label ? `<h4>${esc(g.label)}</h4>` : ''}<div class="cf-grid">${g.keys.filter((k) => col(k)).map((k) => `<div class="dv-field${g.wide || col(k).type === 'longtext' ? ' wide' : ''}"><span class="field-label">${esc(col(k).label)}</span><span class="slot" data-cslot="${k}"></span></div>`).join('')}</div></div>`).join('')}
          </section>
          <section class="card side-card">
            <header class="card-head"><h2>${icon('comment')}Échanges de l’équipe</h2><span class="muted small">${comments.length || ''}</span></header>
            <form class="composer" data-act="comment">
              <textarea class="input textarea" rows="2" placeholder="Écrire un commentaire pour l’équipe…" aria-label="Commentaire"></textarea>
              <div class="composer-foot">${a.rows.length > 1 ? `<select class="input input-sm" aria-label="Division concernée">${a.rows.map((c) => `<option value="${esc(c.id)}">${esc(c.values.division || '?')}</option>`).join('')}</select>` : `<input type="hidden" value="${esc(a.rows[0].id)}">`}<button class="btn btn-primary btn-sm" type="submit">${icon('send')}<span>Publier</span></button></div>
            </form>
            <ul class="comment-list">${comments.map((cm) => `<li class="comment"><div class="comment-head"><strong>${esc(cm.user || '')}</strong><span class="mini-badge">${esc(store.getContract(cm.contractId)?.values.division || '')}</span><span class="muted small" data-tip="${esc(fmtDateTime(cm.ts))}">${esc(fmtRelative(cm.ts))}</span>${cm.uid === store.me().uid ? `<button class="icon-btn xs" data-del-comment="${esc(cm.id)}" aria-label="Supprimer le commentaire">${icon('trash')}</button>` : ''}</div><p>${esc(cm.text).replace(/\n/g, '<br>')}</p></li>`).join('') || '<li class="muted small">Aucun échange pour l’instant.</li>'}</ul>
          </section>
          <section class="card side-card">
            <header class="card-head"><h2>${icon('history')}Activité récente</h2></header>
            <ul class="act-list">${history.map(historyLine).join('') || '<li class="muted small">Aucune modification récente.</li>'}</ul>
          </section>
        </aside>
      </div>`;
    mountControls(a);
  }

  function mountControls(a) {
    const s = store.state.settings;
    for (const card of page.querySelectorAll('.dv-card')) {
      const c = store.getContract(card.dataset.id);
      if (!c) continue;
      const d = store.state.derived.get(c.id);
      for (const slot of card.querySelectorAll('[data-slot]')) {
        const k = slot.dataset.slot;
        const cl = col(k);
        if (!cl) continue;
        const fc = fieldControl(s, cl, c.values[k], (v) => store.updateField(c.id, k, v), { ctx: { contract: c, derived: d } });
        slot.replaceWith(fc);
      }
    }
    const ids = a.rows.map((c) => c.id);
    for (const slot of page.querySelectorAll('[data-cslot]')) {
      const k = slot.dataset.cslot;
      const cl = col(k);
      const fc = fieldControl(s, cl, clientValue(a.rows, k) ?? (cl.type === 'checkbox' ? false : null), async (v) => {
        const n = await store.bulkUpdate(ids, { [k]: v }, { label: `${cl.label} (${a.client})` });
        if (n > 1) toast(`${cl.label} mis à jour pour les ${n} divisions du client.`, { type: 'success', timeout: 2500 });
      });
      slot.replaceWith(fc);
    }
  }

  async function addDivision(a) {
    const s = store.state.settings;
    const used = new Set(a.rows.map((c) => c.values.division));
    const options = listOptions(s, 'division').filter((o) => !used.has(o.value)).map((o) => ({ value: o.value, label: o.value, color: o.color }));
    optionPicker(page.querySelector('[data-act="add-div"]'), {
      options, title: 'Nouvelle division', allowEmpty: false,
      onChange: async (div) => {
        if (!div) return;
        const base = a.open[0] || a.rows[0];
        const values = { client: a.client, division: div };
        for (const k of [...CLIENT_FIELDS, 'cm', 'juriste', 'kam']) if (base.values[k] !== undefined && base.values[k] !== null) values[k] = base.values[k];
        await store.createContract(values, { assignMe: false });
        toast(`Division ${div} ajoutée à ${a.client}.`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
      },
    });
  }

  page.addEventListener('click', async (e) => {
    const a = account();
    if (!a) return;
    const card = e.target.closest('.dv-card');
    const c = card ? store.getContract(card.dataset.id) : null;
    const stepBtn = e.target.closest('.tk-step[data-step]');
    if (stepBtn && c) {
      if (stepBtn.dataset.step === c.values.reportDiv) return;
      await store.updateField(c.id, 'reportDiv', stepBtn.dataset.step);
      toast(`${a.client} · ${c.values.division} : ${stepName(stepBtn.dataset.step)}`, { type: 'success', timeout: 2500, action: { label: 'Annuler', fn: () => store.undo() } });
      return;
    }
    const jl = e.target.closest('[data-jalon]');
    if (jl && c) {
      const k = jl.dataset.jalon;
      calendarPopover(jl, { value: c.values[k] || null, title: col(k).label, marks: milestoneMarks(store.state.settings), onPick: (v) => store.updateField(c.id, k, v || null) });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'step' && c) {
      stepPicker(e.target.closest('[data-act]'), store.state.settings, c.values.reportDiv || null, async (v) => {
        await store.updateField(c.id, 'reportDiv', v);
      });
    }
    if (act === 'more' && c) {
      const year = Number(store.state.settings.season.year);
      const closed = store.state.derived.get(c.id)?.closed;
      const ferme = listOptions(store.state.settings, 'statutCompte').find((o) => o.role === 'ferme')?.value;
      const actif = listOptions(store.state.settings, 'statutCompte').find((o) => o.role === 'actif')?.value;
      menu(e.target.closest('[data-act]'), [
        { header: `${a.client} · ${c.values.division || ''}` },
        { label: 'Toutes les informations de la division', icon: 'maximize', onClick: () => ctx.openContract(c.id) },
        closed
          ? { label: 'Rouvrir la division', icon: 'refresh', onClick: () => store.updateFields(c.id, { statutCompte: actif, anneeFermeture: null }) }
          : { label: 'Fermer la division (compte fermé)', icon: 'lock', onClick: () => store.updateFields(c.id, { statutCompte: ferme, anneeFermeture: year }) },
        { divider: true },
        { label: 'Supprimer la division', icon: 'trash', danger: true, onClick: async () => {
          if (await confirmDialog({ title: 'Supprimer cette division ?', message: `La ligne ${a.client} · ${c.values.division || ''} sera supprimée pour toute l’équipe (annulable avec Ctrl+Z).`, confirmLabel: 'Supprimer', danger: true })) await store.deleteContracts([c.id]);
        } },
      ], { placement: 'bottom-end' });
    }
    if (act === 'add-div') addDivision(a);
    if (act === 'division' && c) {
      optionPicker(e.target.closest('[data-act]'), {
        options: listOptions(store.state.settings, 'division').map((o) => ({ value: o.value, label: o.value, color: o.color })),
        value: c.values.division || null, title: 'Division', allowEmpty: false,
        onChange: (v) => { if (v && v !== c.values.division) store.updateField(c.id, 'division', v); },
      });
    }
    if (act === 'rename') {
      const name = await promptDialog({ title: 'Renommer le client', label: 'Nom du client', value: a.client, confirmLabel: 'Renommer' });
      if (!name || !name.trim() || name.trim() === a.client) return;
      await store.bulkUpdate(a.rows.map((x) => x.id), { client: name.trim() }, { label: 'Renommage du client' });
      key = accountKey(name.trim());
      ctx.replaceRoute(`compte/${encodeURIComponent(key)}`);
      render();
    }
    const del = e.target.closest('[data-del-comment]');
    if (del) await store.deleteComment(del.dataset.delComment);
  });
  page.addEventListener('toggle', (e) => {
    const card = e.target.closest?.('.dv-card');
    if (card && e.target.matches('.dv-more')) { if (e.target.open) openMore.add(card.dataset.id); else openMore.delete(card.dataset.id); }
  }, true);
  page.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-act="comment"]');
    if (!form) return;
    e.preventDefault();
    const text = form.querySelector('textarea').value.trim();
    if (!text) return;
    const id = form.querySelector('select, input[type="hidden"]').value;
    form.querySelector('textarea').value = '';
    await store.addComment(id, text);
  });
  page.addEventListener('keydown', (e) => {
    if (e.target.matches('.composer textarea') && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.target.closest('form').requestSubmit();
  });
  // Pendant une saisie, les mises à jour reçues attendent la fin de la saisie pour ne pas la perdre.
  page.addEventListener('focusout', () => { setTimeout(() => { if (dirty && !page.contains(document.activeElement)) render(); }, 0); });

  const editing = () => page.contains(document.activeElement) && document.activeElement.matches('input, textarea, select');
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; if (editing() || document.querySelector('.popover')) { dirty = true; return; } render(); }); }; })();

  render();
  return {
    update(evt) { if (['data', 'settings', 'comments', 'history'].includes(evt)) schedule(); },
    route({ sub: next }) { const k = decodeURIComponent(next || ''); if (k && k !== key) { key = k; openMore = new Set(); render(); } },
  };
}

export { fmtNumber, accountHref, stageLabel };
