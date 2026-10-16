// Pipeline : une colonne par statut, cartes déplaçables par glisser-déposer
// (ou par le menu de la carte au clavier et sur mobile).

import { icon } from '../ui/icons.js';
import { avatar, emptyState, levelIcon, optionChip, tagsHTML } from '../ui/components.js';
import { menu, toast } from '../ui/overlay.js';
import { filterBar } from './filterbar.js';
import { columnByKey, listOptions } from '../core/schema.js';
import { diffDays, esc, fmtCountdown, fmtDate, fmtMoneyK, isEmpty } from '../core/utils.js';

export function mount(el, ctx) {
  const { store } = ctx;
  const fb = filterBar(ctx, { quick: true });
  el.innerHTML = '<div class="page page-board"></div>';
  const page = el.firstElementChild;
  page.appendChild(fb.el);
  const board = document.createElement('div');
  board.className = 'board';
  board.setAttribute('aria-label', 'Pipeline des contrats par statut');
  page.appendChild(board);
  let dragId = null;

  function card(c) {
    const s = store.state.settings;
    const d = store.state.derived.get(c.id);
    const v = c.values;
    const today = store.state.today;
    const due = v.echeance ? diffDays(today, v.echeance) : null;
    const prioCol = columnByKey(s, 'priorite');
    return `<article class="kcard${d?.level ? ` lvl-edge-${d.level}` : ''}" draggable="true" data-id="${esc(c.id)}" tabindex="0" aria-label="${esc(v.client || '')}">
      <header class="kcard-head">
        <span class="kcard-ref">${esc(v.ref || '')}</span>
        ${d?.alerts?.length ? `<span class="kcard-alert" data-tip="${esc(d.alerts.map((a) => `• ${a.label}`).join('\n'))}">${levelIcon(d.level)}</span>` : ''}
        <button class="icon-btn kcard-menu" data-menu="${esc(c.id)}" aria-label="Déplacer ou ouvrir" data-tip="Déplacer vers…">${icon('more')}</button>
      </header>
      <h3 class="kcard-title">${esc(v.client || 'Sans nom')}</h3>
      <div class="kcard-tags">${prioCol && v.priorite ? optionChip(s, prioCol.list, v.priorite, { cls: 'chip-sm' }) : ''}${tagsHTML(s, 'division', v.division)}</div>
      ${v.prochaineAction || v.echeance ? `<div class="kcard-action${due !== null && due < 0 && d?.stage !== 'done' ? ' late' : ''}">${icon('clock')}<span>${esc(v.prochaineAction || 'Action à préciser')}${v.echeance ? ` · <strong>${esc(fmtDate(v.echeance, 'dm'))}</strong> <span class="muted">(${esc(fmtCountdown(due))})</span>` : ''}</span></div>` : ''}
      <footer class="kcard-foot">${avatar(store.member(v.cm))}<span class="muted small">${!isEmpty(v.ca) ? esc(fmtMoneyK(v.ca)) : ''}</span>${v.dateSignature ? `<span class="small signed-on">${icon('check')}${esc(fmtDate(v.dateSignature, 'dm'))}</span>` : ''}</footer>
    </article>`;
  }

  function render() {
    const s = store.state.settings;
    if (!store.state.list.length) { board.innerHTML = emptyState({ iconName: 'board', title: 'Aucun contrat', text: 'Les contrats apparaîtront ici, classés par statut.' }); return; }
    const list = store.filtered();
    const statuses = listOptions(s, 'statut');
    const collapsed = new Set(store.state.prefs.boardCollapsed || []);
    const groups = statuses.map((o) => ({ ...o, items: list.filter((c) => c.values.statut === o.value) }));
    const orphan = list.filter((c) => !statuses.some((o) => o.value === c.values.statut));
    if (orphan.length) groups.unshift({ value: '', color: '#a3a7af', stage: 'todo', items: orphan, label: 'Sans statut' });
    const scrollLeft = board.scrollLeft;
    const colScroll = {};
    board.querySelectorAll('.kcol').forEach((c) => { colScroll[c.dataset.status] = c.querySelector('.kcol-body')?.scrollTop || 0; });
    board.innerHTML = groups.map((g) => {
      const isCol = collapsed.has(g.value);
      const ca = g.items.reduce((a, c) => a + (Number(c.values.ca) || 0), 0);
      return `<section class="kcol${isCol ? ' collapsed' : ''} stage-${esc(g.stage || 'active')}" data-status="${esc(g.value)}" style="--c:${esc(g.color)}" aria-label="${esc(g.label || g.value)}">
        <header class="kcol-head">
          <button class="kcol-toggle" data-collapse="${esc(g.value)}" aria-expanded="${!isCol}" data-tip="${isCol ? 'Déplier' : 'Replier'} la colonne"><span class="chip-dot"></span><span class="kcol-title">${esc(g.label || g.value)}</span></button>
          <span class="kcol-count">${g.items.length}</span>
        </header>
        ${isCol ? '' : `<div class="kcol-sub">${ca ? esc(fmtMoneyK(ca)) : '&nbsp;'}</div><div class="kcol-body">${g.items.map(card).join('') || '<div class="kcol-empty">Déposez un contrat ici</div>'}</div>`}
      </section>`;
    }).join('');
    board.scrollLeft = scrollLeft;
    board.querySelectorAll('.kcol').forEach((c) => { const b = c.querySelector('.kcol-body'); if (b) b.scrollTop = colScroll[c.dataset.status] || 0; });
    ctx.navIds = groups.flatMap((g) => g.items.map((c) => c.id));
    paintPresence();
  }

  function paintPresence() {
    board.querySelectorAll('.kcard.peer').forEach((x) => { x.classList.remove('peer'); x.removeAttribute('data-peer'); });
    for (const p of store.peers()) {
      if (!p.contractId) continue;
      const el2 = board.querySelector(`.kcard[data-id="${CSS.escape(p.contractId)}"]`);
      if (el2) { el2.classList.add('peer'); el2.style.setProperty('--peer', p.color || '#eb6834'); el2.setAttribute('data-peer', p.initials || p.name); }
    }
  }

  async function moveTo(id, status) {
    const c = store.getContract(id);
    if (!c || c.values.statut === status) return;
    await store.updateField(id, 'statut', status);
    toast(`« ${c.values.client} » → ${status}`, { type: 'success', timeout: 3000, action: { label: 'Annuler', fn: () => store.undo() } });
  }

  board.addEventListener('dragstart', (e) => {
    const k = e.target.closest('.kcard');
    if (!k) return;
    dragId = k.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => k.classList.add('dragging'));
    board.classList.add('is-dragging');
  });
  board.addEventListener('dragend', () => {
    board.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    board.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    board.classList.remove('is-dragging');
    dragId = null;
    schedule();
  });
  board.addEventListener('dragover', (e) => {
    if (dragId) {
      // Défilement automatique quand on approche du bord du pipeline.
      const r = board.getBoundingClientRect();
      if (e.clientX > r.right - 90) board.scrollLeft += 18;
      else if (e.clientX < r.left + 90) board.scrollLeft -= 18;
    }
    const col = e.target.closest('.kcol');
    if (!col || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    board.querySelectorAll('.drop-target').forEach((x) => { if (x !== col) x.classList.remove('drop-target'); });
    col.classList.add('drop-target');
  });
  board.addEventListener('drop', (e) => {
    const col = e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    col.classList.remove('drop-target');
    if (id && col.dataset.status) moveTo(id, col.dataset.status);
  });

  board.addEventListener('click', (e) => {
    const s = store.state.settings;
    const mb = e.target.closest('[data-menu]');
    if (mb) {
      e.stopPropagation();
      const id = mb.dataset.menu;
      const c = store.getContract(id);
      menu(mb, [
        { label: 'Ouvrir la fiche', icon: 'maximize', onClick: () => ctx.openContract(id) },
        { divider: true },
        { header: 'Déplacer vers' },
        ...listOptions(s, 'statut').map((o) => ({ label: o.value, checked: c?.values.statut === o.value, onClick: () => moveTo(id, o.value) })),
      ], { placement: 'bottom-end' });
      return;
    }
    const tg = e.target.closest('[data-collapse]');
    if (tg) {
      const set = new Set(store.state.prefs.boardCollapsed || []);
      if (set.has(tg.dataset.collapse)) set.delete(tg.dataset.collapse); else set.add(tg.dataset.collapse);
      store.setPrefs({ boardCollapsed: [...set] });
      return;
    }
    const k = e.target.closest('.kcard');
    if (k && !e.target.closest('a, button')) ctx.openContract(k.dataset.id);
  });
  board.addEventListener('keydown', (e) => {
    const k = e.target.closest('.kcard');
    if (!k) return;
    if (e.key === 'Enter') { e.preventDefault(); ctx.openContract(k.dataset.id); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const cards = [...board.querySelectorAll('.kcard')];
      const i = cards.indexOf(k);
      const col = k.closest('.kcol');
      const cols = [...board.querySelectorAll('.kcol')];
      const target = cols[cols.indexOf(col) + (e.key === 'ArrowRight' ? 1 : -1)];
      target?.querySelector('.kcard')?.focus();
      void i;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const sib = e.key === 'ArrowDown' ? k.nextElementSibling : k.previousElementSibling;
      sib?.focus?.();
    }
  });

  render();
  const schedule = (() => { let t = null; return () => { if (t) return; t = requestAnimationFrame(() => { t = null; render(); }); }; })();
  return {
    update(evt) {
      if (evt === 'data' || evt === 'settings') { if (!dragId) schedule(); }
      if (evt === 'prefs') { fb.update(); schedule(); }
      if (evt === 'presence') paintPresence();
    },
    unmount() { ctx.navIds = null; },
  };
}
