// Journal : historique de toutes les modifications (qui, quand, quoi, avant / après), filtrable et exportable.

import { icon } from '../ui/icons.js';
import { avatar, emptyState } from '../ui/components.js';
import { debounce, downloadBlob, esc, fmtDateTime, fmtRelative, norm, toCSV, todayISO } from '../core/utils.js';

const TYPES = [
  { id: '', label: 'Toutes les actions' },
  { id: 'update', label: 'Modifications' },
  { id: 'create', label: 'Créations' },
  { id: 'delete', label: 'Suppressions' },
  { id: 'comment', label: 'Commentaires' },
  { id: 'mail', label: 'Relances' },
  { id: 'import', label: 'Imports et restaurations' },
  { id: 'settings', label: 'Paramètres' },
];
const PERIODS = [
  { id: '', label: 'Toute la saison' },
  { id: '1', label: 'Aujourd’hui' },
  { id: '7', label: '7 derniers jours' },
  { id: '30', label: '30 derniers jours' },
];
const ACTION_LABEL = { update: 'Modification', create: 'Création', delete: 'Suppression', restore: 'Restauration', comment: 'Commentaire', mail: 'Relance', import: 'Import', settings: 'Paramètres', 'restore-all': 'Données', sort: 'Tri des comptes', external: 'Modification sur GitHub' };

export function mount(el, ctx) {
  const { store } = ctx;
  const f = { user: '', type: '', period: '', q: '' };
  let limit = 200;
  let older = [];
  let exhausted = !store.state.backend.historyIsPartial;
  const allEntries = () => store.dedupeHistory([store.state.history, older]);
  el.innerHTML = `<div class="page page-journal">
    <div class="filterbar"><div class="filterbar-row">
      <label class="search">${icon('search')}<input type="search" placeholder="Rechercher un contrat, un champ, une valeur…" aria-label="Rechercher dans le journal"></label>
      <select class="input select-sm" data-f="user" aria-label="Utilisateur"></select>
      <select class="input select-sm" data-f="type" aria-label="Type d’action">${TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select>
      <select class="input select-sm" data-f="period" aria-label="Période">${PERIODS.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select>
      <div class="filterbar-extra"><button class="btn btn-secondary btn-sm" data-act="csv">${icon('download')}<span>Exporter (CSV)</span></button></div>
    </div></div>
    <div class="card journal-card"><div class="journal" role="table" aria-label="Journal des modifications"></div><div class="journal-more"></div></div>
  </div>`;
  const listEl = el.querySelector('.journal');
  const moreEl = el.querySelector('.journal-more');
  const userSel = el.querySelector('[data-f="user"]');

  function filteredEntries() {
    const now = Date.now();
    const q = norm(f.q);
    return allEntries().filter((h) => {
      if (f.user && h.user !== f.user) return false;
      if (f.type) {
        if (f.type === 'import' && !['import', 'restore-all', 'restore'].includes(h.action)) return false;
        if (f.type !== 'import' && h.action !== f.type) return false;
      }
      if (f.period) {
        const days = Number(f.period);
        if (days === 1) { if (new Date(h.ts).toDateString() !== new Date(now).toDateString()) return false; } else if (now - h.ts > days * 86400000) return false;
      }
      if (q && !norm([h.contractRef, h.contractLabel, h.fieldLabel, h.from, h.to, h.user].join(' ')).includes(q)) return false;
      return true;
    });
  }

  function render() {
    const users = [...new Set(allEntries().map((h) => h.user).filter(Boolean))].sort();
    userSel.innerHTML = `<option value="">Tous les utilisateurs</option>${users.map((u) => `<option ${u === f.user ? 'selected' : ''}>${esc(u)}</option>`).join('')}`;
    const entries = filteredEntries();
    if (!entries.length) {
      listEl.innerHTML = emptyState({ iconName: 'history', title: store.state.history.length ? 'Aucune entrée ne correspond aux filtres' : 'Le journal est vide', text: 'Chaque modification (statut, date, commentaire, import…) est enregistrée ici avec son auteur.' });
      moreEl.innerHTML = '';
      return;
    }
    let lastDay = '';
    const rows = [];
    for (const h of entries.slice(0, limit)) {
      const day = new Date(h.ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (day !== lastDay) { rows.push(`<div class="j-day" role="row"><span role="cell">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</span></div>`); lastDay = day; }
      const exists = h.contractId && store.getContract(h.contractId);
      const member = (store.state.settings.team || []).find((t) => t.name === h.user);
      rows.push(`<div class="j-row" role="row">
        <span class="j-time" role="cell" data-tip="${esc(fmtDateTime(h.ts))}">${esc(new Date(h.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}</span>
        <span class="j-user" role="cell">${avatar({ name: h.user || '?', color: member?.color || '#8d9099' }, { title: false })}<span>${esc(h.user || '')}</span></span>
        <span class="j-what" role="cell">
          ${h.contractLabel ? `<button class="link-btn j-contract" ${exists ? `data-open="${esc(h.contractId)}"` : 'disabled'}>${esc(h.contractRef ? `${h.contractRef} · ` : '')}${esc(h.contractLabel)}</button>` : ''}
          <span class="j-action">${esc(ACTION_LABEL[h.action] || h.action)}${h.fieldLabel ? ` · <strong>${esc(h.fieldLabel)}</strong>` : ''}${h.auto ? ' <span class="badge">auto</span>' : ''}${h.undo ? ' <span class="badge">annulation</span>' : ''}</span>
          ${h.action === 'update' ? `<span class="tl-change"><span class="from">${esc(h.from || '∅')}</span>${icon('chevronRight')}<span class="to">${esc(h.to || '∅')}</span></span>` : h.to ? `<span class="tl-change"><span class="to">${esc(h.to)}</span></span>` : ''}
        </span>
        <span class="j-ago muted small" role="cell">${esc(fmtRelative(h.ts))}</span>
      </div>`);
    }
    listEl.innerHTML = rows.join('');
    moreEl.innerHTML = entries.length > limit ? `<button class="btn btn-ghost" data-act="more">Afficher plus (${entries.length - limit} restantes)</button>`
      : !exhausted ? `<button class="btn btn-ghost" data-act="older">Charger les entrées plus anciennes</button>` : `<span class="muted small">${entries.length} entrée(s)</span>`;
  }

  const pageEl = el.querySelector('.page-journal');
  pageEl.addEventListener('change', (e) => {
    const k = e.target.dataset.f;
    if (k) { f[k] = e.target.value; limit = 200; render(); }
  });
  const onSearch = debounce((v) => { f.q = v; limit = 200; render(); }, 180);
  el.querySelector('input[type="search"]').addEventListener('input', (e) => onSearch(e.target.value));
  pageEl.addEventListener('click', async (e) => {
    const o = e.target.closest('[data-open]');
    if (o) { ctx.openContract(o.dataset.open, { tab: 'history' }); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'more') { limit += 300; render(); }
    if (act === 'older') {
      const all = allEntries();
      const page = await store.olderHistory(all.length ? all[all.length - 1] : null, 500);
      older = store.dedupeHistory([older, page]);
      if (page.length < 500) exhausted = true;
      limit += 500;
      render();
    }
    if (act === 'csv') {
      if (!exhausted) { older = store.dedupeHistory([older, await store.fullHistory()]); exhausted = true; }
      const rows = [['Date et heure', 'Utilisateur', 'Réf.', 'Contrat', 'Action', 'Champ', 'Ancienne valeur', 'Nouvelle valeur'],
        ...filteredEntries().map((h) => [fmtDateTime(h.ts), h.user || '', h.contractRef || '', h.contractLabel || '', ACTION_LABEL[h.action] || h.action, h.fieldLabel || '', h.from || '', h.to || ''])];
      downloadBlob(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), `Journal_${todayISO()}.csv`);
    }
  });

  render();
  let lastLive = store.state.history.slice();
  return {
    update(evt) {
      if (evt === 'history') {
        // Les entrées qui sortent de la fenêtre temps réel restent visibles.
        if (older.length) older = store.dedupeHistory([older, lastLive]);
        lastLive = store.state.history.slice();
      }
      if (evt === 'history' || evt === 'data') render();
    },
  };
}
