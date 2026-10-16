// Fiche contrat (panneau latéral) : tous les champs, étapes du statut, alertes,
// commentaires, historique du contrat et relances par e-mail.

import { icon } from '../ui/icons.js';
import {
  alertList, avatar, fieldControl, optionChip, optionPicker, optionsForColumn, personHTML, progressHTML,
} from '../ui/components.js';
import { confirmDialog, menu, toast } from '../ui/overlay.js';
import { readHash, writeHash } from '../ui/nav.js';
import { columnByKey, FIELD_GROUPS, listOptions, milestoneByRole } from '../core/schema.js';
import { displayValue } from '../core/compute.js';
import {
  addDays, copyText, diffDays, esc, fmtDate, fmtDateTime, fmtRelative, isEmpty,
} from '../core/utils.js';

let state = null; // { id, el, tab, controls: Map, ctx }

export const currentContractId = () => state?.id || null;

function setHashParam(id) {
  const raw = readHash().replace(/^#\/?/, '');
  const [path] = raw.split('?');
  const next = id ? `#/${path || 'suivi'}?c=${encodeURIComponent(id)}` : `#/${path}`;
  if (readHash() !== next) writeHash(next);
}

export function openContract(ctx, id, { fromRoute = false, tab = null } = {}) {
  const { store } = ctx;
  const contract = store.getContract(id);
  if (!contract) {
    if (store.state.loaded.contracts) toast('Ce contrat n’existe plus.', { type: 'warning' });
    return;
  }
  const host = document.getElementById('drawer-root');
  if (!state) {
    host.innerHTML = `<div class="drawer-backdrop"></div><aside class="drawer" role="dialog" aria-modal="false" aria-label="Fiche contrat" tabindex="-1"></aside>`;
    host.querySelector('.drawer-backdrop').addEventListener('click', () => closeContract());
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => host.classList.add('open'));
  }
  state = { id, el: host.querySelector('.drawer'), tab: tab || state?.tab || 'fiche', controls: new Map(), ctx };
  if (!fromRoute) setHashParam(id);
  render();
  store.setPresence({ contractId: id, field: null });
  state.el.focus({ preventScroll: true });
}

export function closeContract({ fromRoute = false } = {}) {
  if (!state) return;
  const host = document.getElementById('drawer-root');
  const { ctx } = state;
  state = null;
  host.classList.remove('open');
  document.removeEventListener('keydown', onKey);
  setTimeout(() => { if (!state) host.innerHTML = ''; }, 220);
  if (!fromRoute) setHashParam(null);
  ctx.store.setPresence({ contractId: null, field: null });
}

function onKey(e) {
  if (e.key === 'Escape' && state && !document.querySelector('.modal-backdrop, .popover')) {
    const inField = e.target.closest?.('input, textarea');
    if (inField) { inField.blur(); return; }
    closeContract();
  }
}

export function updateDrawer(ctx, evt, payload) {
  if (!state) return;
  const c = ctx.store.getContract(state.id);
  if (!c) {
    if (evt === 'data') { toast('Ce contrat vient d’être supprimé.', { type: 'warning' }); closeContract(); }
    return;
  }
  if (evt === 'data') {
    const remoteKeys = (payload?.remote || []).filter((r) => r.id === state.id).flatMap((r) => r.keys || []);
    refreshHeader();
    if (state.tab === 'fiche') {
      for (const [key, ctrl] of state.controls) {
        ctrl.setValue?.(c.values[key]);
        if (remoteKeys.includes(key)) flashField(key, payload.remote.find((r) => r.id === state.id)?.by);
      }
      refreshComputed();
    }
    if (payload?.reason === 'settings') renderPreservingFocus();
  }
  if (evt === 'comments' && state.tab === 'comments') renderTab();
  if (evt === 'comments') refreshTabs();
  if (evt === 'history' && state.tab === 'history') renderTab();
  if (evt === 'presence') renderPeers();
}

/** Re-rendu complet (paramètres modifiés) sans perdre une saisie en cours : différé jusqu'à la sortie du champ. */
function renderPreservingFocus() {
  if (!state) return;
  if (state.el.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) {
    if (state.pendingRender) return;
    state.pendingRender = true;
    const el = state.el;
    const onOut = () => {
      setTimeout(() => {
        if (!state || state.el !== el) return;
        if (el.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
        el.removeEventListener('focusout', onOut);
        state.pendingRender = false;
        render();
      }, 0);
    };
    el.addEventListener('focusout', onOut);
    return;
  }
  render();
}

function flashField(key, by) {
  const row = state.el.querySelector(`.field-row[data-key="${CSS.escape(key)}"]`);
  if (!row) return;
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
  if (by) {
    let tag = row.querySelector('.field-by');
    if (!tag) { tag = document.createElement('span'); tag.className = 'field-by'; row.querySelector('.field-label')?.appendChild(tag); }
    tag.textContent = `modifié par ${by}`;
    setTimeout(() => tag.remove(), 6000);
  }
}

/* ------------------------------------------------------------ Rendu */

function render() {
  const { ctx } = state;
  const { store } = ctx;
  const c = store.getContract(state.id);
  if (!c) return;
  state.el.innerHTML = `
    <header class="drawer-head">
      <div class="drawer-toprow">
        <span class="drawer-ref" id="dr-ref"></span>
        <div class="drawer-tools">
          <button class="icon-btn" data-act="prev" data-tip="Contrat précédent" aria-label="Contrat précédent">${icon('chevronUp')}</button>
          <button class="icon-btn" data-act="next" data-tip="Contrat suivant" aria-label="Contrat suivant">${icon('chevronDown')}</button>
          <button class="icon-btn" data-act="more" data-tip="Plus d’actions" aria-label="Plus d’actions">${icon('more')}</button>
          <button class="icon-btn" data-act="close" data-tip="Fermer (Échap)" aria-label="Fermer">${icon('close')}</button>
        </div>
      </div>
      <input class="drawer-title" id="dr-title" aria-label="Client / enseigne" spellcheck="false">
      <div class="drawer-meta" id="dr-meta"></div>
      <div class="drawer-peers" id="dr-peers"></div>
    </header>
    <div class="stepper-wrap"><ol class="stepper" id="dr-steps" aria-label="Étapes du statut"></ol></div>
    <div id="dr-alerts"></div>
    <nav class="tabs" role="tablist" id="dr-tabs"></nav>
    <div class="drawer-body" id="dr-body"></div>`;

  const title = state.el.querySelector('#dr-title');
  title.value = c.values.client || '';
  title.addEventListener('focus', () => store.setPresence({ contractId: state.id, field: 'client' }));
  title.addEventListener('change', () => {
    const v = title.value.trim();
    if (!v) { title.value = store.getContract(state.id)?.values.client || ''; toast('Le nom du client est obligatoire.', { type: 'warning' }); return; }
    store.updateField(state.id, 'client', v);
  });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });

  state.el.querySelector('.drawer-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') closeContract();
    if (act === 'prev' || act === 'next') step(act === 'next' ? 1 : -1);
    if (act === 'more') moreMenu(b);
  });

  refreshHeader();
  refreshTabs();
  renderTab();
  renderPeers();
}

function navOrder() {
  const { store } = state.ctx;
  const ids = state.ctx.navIds?.length ? state.ctx.navIds : store.state.list.slice().sort((a, b) => String(a.values.ref).localeCompare(String(b.values.ref), 'fr', { numeric: true })).map((c) => c.id);
  return ids.filter((id) => store.getContract(id));
}

function step(dir) {
  const ids = navOrder();
  const i = ids.indexOf(state.id);
  const next = ids[(i + dir + ids.length) % ids.length];
  if (next && next !== state.id) openContract(state.ctx, next);
}

function moreMenu(anchor) {
  const { ctx } = state;
  const { store } = ctx;
  const id = state.id;
  menu(anchor, [
    { label: 'Copier le lien vers cette fiche', icon: 'link', onClick: async () => { await copyText(`${location.origin}${location.pathname}#/suivi?c=${id}`); toast('Lien copié.', { type: 'success', timeout: 2000 }); } },
    { label: 'Dupliquer le contrat', icon: 'copy', onClick: async () => { const nid = await store.duplicateContract(id); if (nid) { toast('Contrat dupliqué.', { type: 'success' }); openContract(ctx, nid); } } },
    { divider: true },
    {
      label: 'Supprimer le contrat', icon: 'trash', danger: true, onClick: async () => {
        const c = store.getContract(id);
        const ok = await confirmDialog({ title: 'Supprimer ce contrat ?', message: `« ${c?.values.client} » sera supprimé pour tous les utilisateurs. Vous pourrez annuler juste après (Ctrl+Z).`, confirmLabel: 'Supprimer', danger: true });
        if (!ok) return;
        closeContract();
        await store.deleteContracts([id]);
        toast('Contrat supprimé.', { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
      },
    },
  ], { placement: 'bottom-end' });
}

function refreshHeader() {
  const { store } = state.ctx;
  const s = store.state.settings;
  const c = store.getContract(state.id);
  const d = store.state.derived.get(state.id);
  if (!c) return;
  const el = state.el;
  el.querySelector('#dr-ref').innerHTML = `<strong>${esc(c.values.ref || '')}</strong>${c.updatedAt ? ` · modifié ${esc(fmtRelative(c.updatedAt))}${c.updatedByName ? ` par ${esc(c.updatedByName)}` : ''}` : ''}`;
  const title = el.querySelector('#dr-title');
  if (document.activeElement !== title) title.value = c.values.client || '';

  const statusCol = columnByKey(s, 'statut');
  const cmCol = columnByKey(s, 'cm');
  const prioCol = columnByKey(s, 'priorite');
  el.querySelector('#dr-meta').innerHTML = `
    ${statusCol ? `<button class="meta-pick" data-key="statut" aria-label="Changer le statut">${optionChip(s, 'statut', c.values.statut) || '<span class="muted">Statut</span>'}${icon('chevronDown', 'caret')}</button>` : ''}
    ${cmCol ? `<button class="meta-pick" data-key="cm" aria-label="Changer le contract manager">${personHTML(s, c.values.cm) || '<span class="muted">Contract manager</span>'}${icon('chevronDown', 'caret')}</button>` : ''}
    ${prioCol ? `<button class="meta-pick" data-key="priorite" aria-label="Changer la priorité">${optionChip(s, prioCol.list, c.values.priorite) || '<span class="muted">Priorité</span>'}${icon('chevronDown', 'caret')}</button>` : ''}
    <span class="meta-progress">${progressHTML(d?.progress, d?.stage)}</span>`;
  el.querySelectorAll('.meta-pick').forEach((b) => b.addEventListener('click', () => {
    const col = columnByKey(s, b.dataset.key);
    optionPicker(b, {
      options: optionsForColumn(s, col), value: c.values[col.key], title: col.label,
      onChange: (v) => store.updateField(state.id, col.key, v),
    });
  }));

  // Étapes : statuts du parcours (hors bloqué / abandonné).
  const statuses = listOptions(s, 'statut');
  const flow = statuses.filter((o) => o.stage === 'todo' || o.stage === 'active' || o.stage === 'done');
  const curIdx = flow.findIndex((o) => o.value === c.values.statut);
  const off = statuses.find((o) => o.value === c.values.statut && (o.stage === 'blocked' || o.stage === 'cancelled'));
  el.querySelector('#dr-steps').innerHTML = flow.map((o, i) => `<li class="step${i < curIdx ? ' done' : ''}${i === curIdx ? ' current' : ''}"><button type="button" data-value="${esc(o.value)}" data-tip="Passer au statut « ${esc(o.value)} »" aria-label="${esc(o.value)}${i === curIdx ? ' (statut actuel)' : ''}"><span class="step-dot">${i < curIdx || (i === curIdx && o.stage === 'done') ? icon('check') : ''}</span><span class="step-label">${esc(o.value)}</span></button></li>`).join('')
    + (off ? `<li class="step off"><span class="step-off">${icon(off.stage === 'blocked' ? 'pause' : 'xCircle')}${esc(off.value)}</span></li>` : '');
  el.querySelector('#dr-steps').onclick = (e) => {
    const b = e.target.closest('button[data-value]');
    if (b) store.updateField(state.id, 'statut', b.dataset.value);
  };
  el.querySelector('#dr-alerts').innerHTML = d?.alerts?.length ? `<div class="drawer-alerts">${alertList(d.alerts)}</div>` : '';
}

function refreshComputed() {
  const { store } = state.ctx;
  const c = store.getContract(state.id);
  const d = store.state.derived.get(state.id);
  for (const el of state.el.querySelectorAll('.fc-computed')) {
    const col = columnByKey(store.state.settings, el.dataset.key);
    if (col) el.replaceWith(fieldControl(store.state.settings, col, null, () => {}, { ctx: { contract: c, derived: d } }));
  }
}

function refreshTabs() {
  const { store } = state.ctx;
  const nComments = store.state.comments.filter((x) => x.contractId === state.id).length;
  const tabs = [
    { id: 'fiche', label: 'Fiche' },
    { id: 'comments', label: `Commentaires${nComments ? ` (${nComments})` : ''}` },
    { id: 'history', label: 'Historique' },
    { id: 'mail', label: 'Relance' },
  ];
  const nav = state.el.querySelector('#dr-tabs');
  nav.innerHTML = tabs.map((t) => `<button role="tab" class="tab${t.id === state.tab ? ' active' : ''}" aria-selected="${t.id === state.tab}" data-tab="${t.id}">${esc(t.label)}</button>`).join('');
  nav.onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    refreshTabs();
    renderTab();
  };
}

function renderPeers() {
  const { store } = state.ctx;
  const peers = store.peers().filter((p) => p.contractId === state.id);
  const el = state.el.querySelector('#dr-peers');
  if (!el) return;
  el.innerHTML = peers.length ? `<div class="peer-note">${peers.map((p) => avatar({ name: p.name, color: p.color, initials: p.initials }, { title: false })).join('')}<span>${esc(peers.map((p) => p.name).join(', '))} ${peers.length > 1 ? 'consultent' : 'consulte'} aussi cette fiche${peers.some((p) => p.field) ? ` · modification en cours : ${esc(peers.filter((p) => p.field).map((p) => columnByKey(store.state.settings, p.field)?.label || p.field).join(', '))}` : ''}</span></div>` : '';
  for (const row of state.el.querySelectorAll('.field-row')) {
    const peer = peers.find((p) => p.field === row.dataset.key);
    row.classList.toggle('peer-editing', !!peer);
    row.style.setProperty('--peer', peer?.color || 'transparent');
    if (peer) row.setAttribute('data-peer', peer.name); else row.removeAttribute('data-peer');
  }
}

function renderTab() {
  const body = state.el.querySelector('#dr-body');
  state.controls = new Map();
  if (state.tab === 'fiche') renderFields(body);
  else if (state.tab === 'comments') renderComments(body);
  else if (state.tab === 'history') renderHistory(body);
  else renderMail(body);
}

function renderFields(body) {
  const { store } = state.ctx;
  const s = store.state.settings;
  const c = store.getContract(state.id);
  const d = store.state.derived.get(state.id);
  body.innerHTML = '';
  const skip = new Set(['client', 'statut', 'cm', 'priorite', '_alerts']);
  for (const g of FIELD_GROUPS) {
    const cols = s.columns.filter((col) => (col.group || 'autres') === g.id && !skip.has(col.key));
    if (!cols.length) continue;
    const sec = document.createElement('section');
    sec.className = 'field-group';
    sec.innerHTML = `<h3 class="field-group-title">${esc(g.label)}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'field-grid';
    for (const col of cols) {
      const row = document.createElement('div');
      row.className = `field-row${col.type === 'longtext' ? ' wide' : ''}`;
      row.dataset.key = col.key;
      row.innerHTML = `<label class="field-label">${esc(col.label)}${col.required ? ' <span class="req">*</span>' : ''}</label>`;
      const ctrl = fieldControl(s, col, c.values[col.key], (v) => store.updateField(state.id, col.key, v), { ctx: { contract: c, derived: d } });
      if (col.type === 'computed') ctrl.classList.add('fc-computed');
      row.appendChild(ctrl);
      row.addEventListener('focusin', () => store.setPresence({ contractId: state.id, field: col.key }));
      row.addEventListener('focusout', () => store.setPresence({ contractId: state.id, field: null }));
      grid.appendChild(row);
      state.controls.set(col.key, ctrl);
    }
    sec.appendChild(grid);
    body.appendChild(sec);
  }
  const meta = document.createElement('p');
  meta.className = 'drawer-foot-meta';
  meta.innerHTML = `Créé ${c.createdAt ? `le ${esc(fmtDateTime(c.createdAt))}` : ''}${c.createdByName ? ` par ${esc(c.createdByName)}` : ''}.`;
  body.appendChild(meta);
  renderPeers();
}

function renderComments(body) {
  const { store } = state.ctx;
  const me = store.me();
  const list = store.state.comments.filter((x) => x.contractId === state.id);
  body.innerHTML = `
    <div class="comments">${list.length ? list.map((cm) => `
      <article class="comment${cm.uid === me.uid ? ' mine' : ''}">
        ${avatar({ name: cm.user, color: store.state.settings.team.find((t) => t.name === cm.user)?.color || '#8d9099' }, { title: false })}
        <div class="comment-body">
          <header><strong>${esc(cm.user)}</strong><time data-tip="${esc(fmtDateTime(cm.ts))}">${esc(fmtRelative(cm.ts))}</time>${cm.uid === me.uid ? `<button class="link-btn" data-del="${esc(cm.id)}">Supprimer</button>` : ''}</header>
          <p>${esc(cm.text).replace(/\n/g, '<br>')}</p>
        </div>
      </article>`).join('') : `<p class="muted center pad">Aucun commentaire pour l’instant. Les commentaires sont visibles par toute l’équipe.</p>`}</div>
    <form class="composer">
      <textarea class="input textarea" rows="3" placeholder="Écrire un commentaire… (Ctrl+Entrée pour envoyer)" aria-label="Nouveau commentaire"></textarea>
      <button class="btn btn-primary" type="submit">${icon('send')}<span>Publier</span></button>
    </form>`;
  const form = body.querySelector('.composer');
  const ta = form.querySelector('textarea');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    await store.addComment(state.id, text);
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (await confirmDialog({ title: 'Supprimer ce commentaire ?', confirmLabel: 'Supprimer', danger: true })) store.deleteComment(b.dataset.del);
  }));
  const thread = body.querySelector('.comments');
  thread.scrollTop = thread.scrollHeight;
}

const ACTION_LABEL = { create: 'a créé le contrat', delete: 'a supprimé le contrat', restore: 'a restauré le contrat', comment: 'a commenté', mail: 'a préparé une relance', import: 'a importé des données' };

function renderHistory(body) {
  const { store } = state.ctx;
  const id = state.id;
  if (!state.fullHistory || state.fullHistory.id !== id) {
    state.fullHistory = { id, entries: null };
    store.contractHistory(id).then((entries) => {
      if (state?.id !== id) return;
      state.fullHistory = { id, entries };
      if (state.tab === 'history') renderTab();
    });
  }
  const list = store.dedupeHistory([store.state.history.filter((h) => h.contractId === id), state.fullHistory.entries]);
  body.innerHTML = list.length ? `<ol class="timeline">${list.map((h) => `
    <li class="tl-item">
      <span class="tl-dot"></span>
      <div class="tl-body">
        <div class="tl-head"><strong>${esc(h.user || '')}</strong> ${h.action === 'update' ? `a modifié <em>${esc(h.fieldLabel || h.field)}</em>${h.auto ? ' <span class="badge">auto</span>' : ''}${h.undo ? ' <span class="badge">annulation</span>' : ''}` : esc(ACTION_LABEL[h.action] || h.action)}</div>
        ${h.action === 'update' ? `<div class="tl-change"><span class="from">${esc(h.from || '∅')}</span>${icon('chevronRight')}<span class="to">${esc(h.to || '∅')}</span></div>` : h.to ? `<div class="tl-change"><span class="to">${esc(h.to)}</span></div>` : ''}
        <time class="tl-time">${esc(fmtDateTime(h.ts))}</time>
      </div>
    </li>`).join('')}</ol>` : '<p class="muted center pad">Aucune modification enregistrée pour ce contrat.</p>';
}

function fillTemplate(text, ctx, contract) {
  const { store } = ctx;
  const s = store.state.settings;
  const sig = milestoneByRole(s, 'signature');
  const me = store.me();
  const vals = {
    saison: s.season.name,
    annee: String(s.season.year || ''),
    dateButoir: sig ? fmtDate(sig.date, 'long') : '',
    joursButoir: sig ? String(Math.max(0, diffDays(store.state.today, sig.date))) : '',
    moi: me.name,
    cm: store.member(contract.values.cm)?.name || '',
  };
  for (const col of s.columns) {
    if (col.type === 'computed') continue;
    const v = displayValue(s, contract, col);
    if (!(col.key in vals)) vals[col.key] = col.type === 'date' && contract.values[col.key] ? fmtDate(contract.values[col.key], 'long') : v;
  }
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? (vals[k] || '—') : m));
}

function renderMail(body) {
  const { ctx } = state;
  const { store } = ctx;
  const s = store.state.settings;
  const c = store.getContract(state.id);
  const templates = s.emailTemplates || [];
  const contactCol = s.columns.find((col) => col.type === 'email');
  body.innerHTML = templates.length ? `
    <div class="mail-form">
      <label class="field"><span class="field-label">Modèle</span>
        <select class="input" id="mail-tpl">${templates.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Destinataire(s)</span><input class="input" id="mail-to" type="text" placeholder="adresse@client.fr ; autre@client.fr"></label>
      <label class="field"><span class="field-label">Objet</span><input class="input" id="mail-subject" type="text"></label>
      <label class="field"><span class="field-label">Message</span><textarea class="input textarea" id="mail-body" rows="11"></textarea></label>
      <label class="check"><input type="checkbox" id="mail-follow" checked><span>Programmer la prochaine relance dans <input class="input input-xs" type="number" id="mail-days" min="1" max="60" value="${esc(s.automations?.followUpDays || 7)}"> jours (met à jour « Prochaine action » et « Échéance »)</span></label>
      <div class="mail-actions">
        <button class="btn btn-primary" id="mail-open">${icon('mail')}<span>Ouvrir dans la messagerie</span></button>
        <button class="btn btn-secondary" id="mail-copy">${icon('copy')}<span>Copier le texte</span></button>
      </div>
      <p class="muted small">Les modèles se modifient dans Paramètres › Modèles de relance. Variables disponibles : {client}, {dateCgv}, {dateButoir}, {joursButoir}, {version}, {statut}, {kam}, {moi}…</p>
    </div>` : '<p class="muted center pad">Aucun modèle de relance. Ajoutez-en dans Paramètres › Modèles de relance.</p>';
  if (!templates.length) return;
  const $ = (id) => body.querySelector(id);
  const apply = () => {
    const t = templates.find((x) => x.id === $('#mail-tpl').value) || templates[0];
    $('#mail-subject').value = fillTemplate(t.subject, ctx, c);
    $('#mail-body').value = fillTemplate(t.body, ctx, c);
  };
  if (contactCol && c.values[contactCol.key]) $('#mail-to').value = c.values[contactCol.key];
  $('#mail-tpl').addEventListener('change', apply);
  apply();
  const after = async (how) => {
    const t = templates.find((x) => x.id === $('#mail-tpl').value);
    await store.logEvent(state.id, { action: 'mail', to: `${t?.name || 'Relance'} (${how})` });
    if ($('#mail-follow').checked) {
      const days = Math.max(1, Math.min(60, Number($('#mail-days').value) || 7));
      const patch = { echeance: addDays(store.state.today, days) };
      if (columnByKey(s, 'prochaineAction')) patch.prochaineAction = `Relancer si pas de retour : ${t?.name || 'relance'}`;
      await store.updateFields(state.id, patch);
      toast(`Prochaine relance programmée le ${fmtDate(patch.echeance)}.`, { type: 'success' });
    }
  };
  $('#mail-open').addEventListener('click', async () => {
    const to = $('#mail-to').value.split(/[;,\s]+/).filter(Boolean).join(';');
    const href = `mailto:${encodeURIComponent(to).replace(/%3B/g, ';').replace(/%40/g, '@')}?subject=${encodeURIComponent($('#mail-subject').value)}&body=${encodeURIComponent($('#mail-body').value)}`;
    window.location.href = href;
    await after('messagerie');
  });
  $('#mail-copy').addEventListener('click', async () => {
    const ok = await copyText(`Objet : ${$('#mail-subject').value}\n\n${$('#mail-body').value}`);
    toast(ok ? 'Texte copié dans le presse-papiers.' : 'Copie impossible.', { type: ok ? 'success' : 'error', timeout: 2500 });
    if (ok) await after('copie');
  });
}

export function isEmptyValue(v) { return isEmpty(v); }
