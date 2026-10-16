// Suivi des contrats : grille éditable façon tableur, partagée en temps réel.
// Édition dans la cellule, navigation au clavier, copier-coller avec Excel, tri, filtres de colonne,
// regroupement, sélection de lignes et actions groupées, indicateurs de présence des collègues.

import { icon } from '../ui/icons.js';
import {
  avatar, calendarPopover, cellHTML, emptyState, milestoneMarks, optionPicker, optionsForColumn,
} from '../ui/components.js';
import { confirmDialog, menu, popover, toast } from '../ui/overlay.js';
import { filterBar } from './filterbar.js';
import {
  coerceValue, compareSortValues, displayValue, sortValue,
} from '../core/compute.js';
import { columnByKey, listOptions, SWATCHES } from '../core/schema.js';
import {
  debounce, esc, fmtMoneyK, fmtNumber, isEmpty, norm, parseTSV, pluralize, toTSV,
} from '../core/utils.js';
import { exportMenu, openImportDialog } from './importer.js';

const SEL_W = 44;
const GROUPABLE = ['statut', 'cm', 'canal', 'division', 'priorite', 'typeContrat'];

export function mount(el, ctx) {
  const { store } = ctx;
  const extra = `
    <div class="toolbar-group">
      <button class="btn btn-ghost btn-sm" data-act="group">${icon('layers')}<span class="lbl-group">Regrouper</span></button>
      <button class="btn btn-ghost btn-sm" data-act="columns">${icon('columns')}<span>Colonnes</span></button>
      <button class="btn btn-ghost btn-sm" data-act="density" data-tip="Densité d’affichage">${icon('rows')}</button>
      <button class="btn btn-ghost btn-sm" data-act="import" data-tip="Importer un fichier Excel ou un collage">${icon('upload')}<span class="hide-md">Importer</span></button>
      <button class="btn btn-secondary btn-sm" data-act="export">${icon('download')}<span>Exporter</span></button>
    </div>`;
  const fb = filterBar(ctx, { quick: true, extra });
  el.innerHTML = '<div class="page page-table"></div>';
  const page = el.firstElementChild;
  page.appendChild(fb.el);
  const bulkEl = document.createElement('div');
  bulkEl.className = 'bulkbar';
  bulkEl.hidden = true;
  page.appendChild(bulkEl);
  const card = document.createElement('div');
  card.className = 'card grid-card';
  card.innerHTML = `
    <div class="grid-scroll" tabindex="0" role="grid" aria-label="Tableau de suivi des contrats" aria-multiselectable="true">
      <table class="grid"><colgroup></colgroup><thead></thead><tbody></tbody></table>
    </div>
    <div class="grid-foot"><button class="btn btn-ghost btn-sm" data-act="add">${icon('plus')}<span>Nouveau contrat</span></button><span class="grid-stats" aria-live="polite"></span><span class="grid-hint">Double-clic ou Entrée pour modifier · Ctrl+C / Ctrl+V avec Excel · Ctrl+Z pour annuler</span></div>`;
  page.appendChild(card);

  const scroller = card.querySelector('.grid-scroll');
  const table = card.querySelector('table');
  const colgroup = table.querySelector('colgroup');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  const stats = card.querySelector('.grid-stats');

  let cols = [];
  let rows = [];
  let active = null; // { r, c }
  let anchor = null; // début de plage
  const selected = new Set();
  let editing = null; // { id, key, el, input, commit, cancel }
  let rerendering = false;
  const flashes = new Map(); // "id|key" -> { until, by }
  let dragSelecting = false;

  /* -------------------------------------------------- Colonnes et lignes */

  function computeColumns() {
    const s = store.state.settings;
    const hidden = store.state.prefs.hiddenColumns;
    cols = s.columns.filter((c) => (hidden ? !hidden.includes(c.key) : !c.hidden));
    // Les colonnes figées doivent être en tête.
    const frozen = cols.filter((c) => c.frozen);
    cols = [...frozen, ...cols.filter((c) => !c.frozen)];
  }

  const widthOf = (col) => store.state.prefs.columnWidths?.[col.key] || col.width || 140;

  function computeRows() {
    const s = store.state.settings;
    const derived = store.state.derived;
    let list = store.filtered();
    const cf = store.state.prefs.columnFilters || {};
    for (const [key, allowed] of Object.entries(cf)) {
      const col = columnByKey(s, key);
      if (!col || !Array.isArray(allowed)) continue;
      const set = new Set(allowed);
      list = list.filter((c) => set.has(filterValue(s, c, col, derived.get(c.id))));
    }
    const sort = (store.state.prefs.sort || []).filter((x) => columnByKey(s, x.key));
    if (sort.length) {
      const keyed = list.map((c) => ({ c, k: sort.map((x) => sortValue(s, c, columnByKey(s, x.key), derived.get(c.id))) }));
      keyed.sort((a, b) => {
        for (let i = 0; i < sort.length; i++) {
          const r = compareSortValues(a.k[i], b.k[i], sort[i].dir);
          if (r) return r;
        }
        return 0;
      });
      list = keyed.map((x) => x.c);
    }
    return list;
  }

  function groupsOf(list) {
    const s = store.state.settings;
    const key = store.state.prefs.groupBy;
    const col = key && columnByKey(s, key);
    if (!col) return null;
    const order = col.type === 'person' ? (s.team || []).map((m) => m.id) : listOptions(s, col.list).map((o) => o.value);
    const map = new Map();
    for (const c of list) {
      const raw = c.values[key];
      const vals = Array.isArray(raw) ? (raw.length ? raw : ['']) : [isEmpty(raw) ? '' : raw];
      for (const v of vals) {
        if (!map.has(v)) map.set(v, []);
        map.get(v).push(c);
        if (col.type !== 'multiselect') break;
      }
    }
    const keys = [...map.keys()].sort((a, b) => {
      const ia = a === '' ? 9999 : order.indexOf(a) < 0 ? 5000 : order.indexOf(a);
      const ib = b === '' ? 9999 : order.indexOf(b) < 0 ? 5000 : order.indexOf(b);
      return ia - ib;
    });
    return keys.map((k) => {
      let label = k || (col.type === 'person' ? 'Non assigné' : 'Non renseigné');
      let color = '#a3a7af';
      if (k && col.type === 'person') { const m = store.member(k); label = m?.name || k; color = m?.color || color; }
      else if (k) color = listOptions(s, col.list).find((o) => o.value === k)?.color || color;
      return { key: `${col.key}:${k}`, label, color, items: map.get(k), member: col.type === 'person' ? store.member(k) : null };
    });
  }

  /* ----------------------------------------------------------- Rendu */

  function renderHead() {
    const s = store.state.settings;
    const sort = store.state.prefs.sort || [];
    const cf = store.state.prefs.columnFilters || {};
    let left = SEL_W;
    const lefts = [];
    cols.forEach((col) => { lefts.push(col.frozen ? left : null); if (col.frozen) left += widthOf(col); });
    colgroup.innerHTML = `<col style="width:${SEL_W}px">${cols.map((c) => `<col data-key="${esc(c.key)}" style="width:${widthOf(c)}px">`).join('')}`;
    table.style.width = `${SEL_W + cols.reduce((a, c) => a + widthOf(c), 0)}px`;
    const allChecked = rows.length && rows.every((c) => selected.has(c.id));
    thead.innerHTML = `<tr>
      <th class="sel frozen" style="left:0"><label class="cbox-wrap" data-tip="Tout sélectionner"><input type="checkbox" data-act="all" ${allChecked ? 'checked' : ''} aria-label="Sélectionner toutes les lignes"></label></th>
      ${cols.map((col, i) => {
        const sIdx = sort.findIndex((x) => x.key === col.key);
        const sdir = sIdx >= 0 ? sort[sIdx].dir : 0;
        const filtered = Array.isArray(cf[col.key]);
        const isLastFrozen = col.frozen && !cols[i + 1]?.frozen;
        return `<th data-key="${esc(col.key)}" data-c="${i}" class="${col.frozen ? 'frozen' : ''}${isLastFrozen ? ' frozen-edge' : ''}${col.align === 'right' || col.type === 'number' ? ' right' : ''}" ${col.frozen ? `style="left:${lefts[i]}px"` : ''} aria-sort="${sdir === 1 ? 'ascending' : sdir === -1 ? 'descending' : 'none'}">
          <div class="th-inner">
            <button class="th-label" data-sort="${esc(col.key)}" data-tip="Trier (Maj+clic : tri secondaire)">${col.type === 'computed' ? '' : ''}<span>${esc(col.label)}</span>${sdir ? `<span class="th-sort">${icon(sdir === 1 ? 'arrowUp' : 'arrowDown')}${sort.length > 1 ? `<sup>${sIdx + 1}</sup>` : ''}</span>` : ''}</button>
            <button class="th-filter${filtered ? ' on' : ''}" data-colfilter="${esc(col.key)}" aria-label="Filtrer la colonne ${esc(col.label)}" data-tip="Filtrer">${icon('filter')}</button>
          </div>
          <span class="th-resize" data-resize="${esc(col.key)}" aria-hidden="true"></span>
        </th>`;
      }).join('')}
    </tr>`;
    void s;
  }

  function cellClass(col) {
    return `cell t-${col.type}${col.frozen ? ' frozen' : ''}${col.readonly || col.type === 'computed' ? ' ro' : ''}${col.align === 'right' || col.type === 'number' ? ' right' : ''}`;
  }

  function rowHTML(c, r, lefts, lastFrozen) {
    const s = store.state.settings;
    const d = store.state.derived.get(c.id);
    const today = store.state.today;
    const sel = selected.has(c.id);
    return `<tr data-id="${esc(c.id)}" class="${sel ? 'selected' : ''}${d?.stage === 'done' ? ' is-done' : ''}${d?.stage === 'cancelled' ? ' is-cancelled' : ''}" aria-rowindex="${r + 2}">
      <td class="sel frozen" style="left:0"><label class="cbox-wrap"><input type="checkbox" data-row="${esc(c.id)}" ${sel ? 'checked' : ''} aria-label="Sélectionner ${esc(c.values.client || '')}"></label>${d?.level === 'critical' || d?.level === 'serious' ? `<span class="row-flag lvl-${d.level}"></span>` : ''}</td>
      ${cols.map((col, i) => `<td data-r="${r}" data-c="${i}" class="${cellClass(col)}${i === lastFrozen ? ' frozen-edge' : ''}" ${col.frozen ? `style="left:${lefts[i]}px"` : ''}>${col.key === 'client' ? `<div class="client-cell"><span class="clip">${esc(c.values.client || '')}</span><button class="open-btn" data-open="${esc(c.id)}" tabindex="-1" aria-label="Ouvrir la fiche" data-tip="Ouvrir la fiche">${icon('maximize')}</button></div>` : cellHTML(s, c, col, d, { today })}</td>`).join('')}
    </tr>`;
  }

  function renderBody() {
    const s = store.state.settings;
    let left = SEL_W;
    const lefts = [];
    let lastFrozen = -1;
    cols.forEach((col, i) => { lefts.push(col.frozen ? left : null); if (col.frozen) { left += widthOf(col); lastFrozen = i; } });
    const list = computeRows();
    const groups = groupsOf(list);
    const collapsed = new Set(store.state.prefs.collapsedGroups || []);
    const out = [];
    rows = [];
    if (!store.state.list.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length + 1}">${emptyState({ iconName: 'sheet', title: 'Aucun contrat', text: 'Importez votre fichier Excel ou créez un premier contrat.', actions: `<button class="btn btn-primary" data-act="import">${icon('upload')}<span>Importer un fichier</span></button><button class="btn btn-secondary" data-act="add">${icon('plus')}<span>Nouveau contrat</span></button>` })}</td></tr>`;
      return;
    }
    if (!list.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols.length + 1}">${emptyState({ iconName: 'filter', title: 'Aucun contrat ne correspond aux filtres', actions: `<button class="btn btn-secondary" data-act="clear-filters">Effacer les filtres</button>` })}</td></tr>`;
      return;
    }
    if (groups) {
      for (const g of groups) {
        const isCol = collapsed.has(g.key);
        const ca = g.items.reduce((a, c) => a + (Number(c.values.ca) || 0), 0);
        out.push(`<tr class="group-row${isCol ? ' collapsed' : ''}"><td colspan="${cols.length + 1}"><button class="group-toggle" data-group="${esc(g.key)}" aria-expanded="${!isCol}">${icon('chevronDown', 'group-caret')}${g.member ? avatar(g.member, { title: false }) : `<span class="chip-dot" style="--c:${esc(g.color)}"></span>`}<strong>${esc(g.label)}</strong><span class="group-count">${g.items.length}</span>${ca ? `<span class="group-ca">${esc(fmtMoneyK(ca))}</span>` : ''}</button></td></tr>`);
        if (isCol) continue;
        for (const c of g.items) { out.push(rowHTML(c, rows.length, lefts, lastFrozen)); rows.push(c); }
      }
    } else {
      for (const c of list) { out.push(rowHTML(c, rows.length, lefts, lastFrozen)); rows.push(c); }
    }
    tbody.innerHTML = out.join('');
    void s;
  }

  function render() {
    const editingState = editing;
    let editorNode = null;
    if (editingState) { rerendering = true; editorNode = editingState.el; editorNode.remove(); }
    computeColumns();
    renderBody();
    renderHead();
    ctx.navIds = rows.map((c) => c.id);
    if (active && (active.r >= rows.length || active.c >= cols.length)) active = rows.length ? { r: Math.min(active.r, rows.length - 1), c: Math.min(active.c, cols.length - 1) } : null;
    paintSelection();
    paintPresence();
    paintFlashes();
    renderStats();
    renderBulk();
    if (editingState) {
      const r = rows.findIndex((c) => c.id === editingState.id);
      const ci = cols.findIndex((c) => c.key === editingState.key);
      const td = r >= 0 && ci >= 0 ? cellEl(r, ci) : null;
      if (td) {
        td.classList.add('editing');
        td.appendChild(editorNode);
        editingState.input?.focus({ preventScroll: true });
        active = { r, c: ci };
      } else editing = null;
      rerendering = false;
    }
  }

  const cellEl = (r, c) => tbody.querySelector(`td[data-r="${r}"][data-c="${c}"]`);

  /* --------------------------------------------------- Sélection active */

  function rangeBounds() {
    if (!active) return null;
    const a = anchor || active;
    return { r0: Math.min(a.r, active.r), r1: Math.max(a.r, active.r), c0: Math.min(a.c, active.c), c1: Math.max(a.c, active.c) };
  }

  function paintSelection() {
    tbody.querySelectorAll('td.active, td.in-range').forEach((td) => td.classList.remove('active', 'in-range', 'rt', 'rb', 'rl', 'rr'));
    thead.querySelectorAll('th.col-active').forEach((th) => th.classList.remove('col-active'));
    if (!active) return;
    const b = rangeBounds();
    const multi = b.r0 !== b.r1 || b.c0 !== b.c1;
    if (multi) {
      for (let r = b.r0; r <= b.r1; r++) {
        for (let c = b.c0; c <= b.c1; c++) {
          const td = cellEl(r, c);
          if (!td) continue;
          td.classList.add('in-range');
          if (r === b.r0) td.classList.add('rt');
          if (r === b.r1) td.classList.add('rb');
          if (c === b.c0) td.classList.add('rl');
          if (c === b.c1) td.classList.add('rr');
        }
      }
    }
    const td = cellEl(active.r, active.c);
    td?.classList.add('active');
    thead.querySelector(`th[data-c="${active.c}"]`)?.classList.add('col-active');
    renderStats();
  }

  function setActive(r, c, { extend = false, scroll = true } = {}) {
    if (!rows.length) return;
    r = Math.max(0, Math.min(rows.length - 1, r));
    c = Math.max(0, Math.min(cols.length - 1, c));
    if (extend) { if (!anchor) anchor = active || { r, c }; } else anchor = null;
    active = { r, c };
    paintSelection();
    if (scroll) ensureVisible(r, c);
    const contract = rows[r];
    if (contract) store.setPresence({ gridCell: { id: contract.id, key: cols[c]?.key } });
  }

  function ensureVisible(r, c) {
    const td = cellEl(r, c);
    if (!td) return;
    const sr = scroller.getBoundingClientRect();
    const tr = td.getBoundingClientRect();
    const frozenW = SEL_W + cols.filter((x) => x.frozen).reduce((a, x) => a + widthOf(x), 0);
    const headH = thead.offsetHeight;
    if (tr.top < sr.top + headH) scroller.scrollTop -= sr.top + headH - tr.top + 2;
    else if (tr.bottom > sr.bottom) scroller.scrollTop += tr.bottom - sr.bottom + 2;
    if (!cols[c].frozen) {
      if (tr.left < sr.left + frozenW) scroller.scrollLeft -= sr.left + frozenW - tr.left + 2;
      else if (tr.right > sr.right) scroller.scrollLeft += tr.right - sr.right + 2;
    }
  }

  /* ------------------------------------------------------- Présence */

  function paintPresence() {
    tbody.querySelectorAll('.peer-cell').forEach((td) => { td.classList.remove('peer-cell'); td.removeAttribute('data-peer'); td.style.removeProperty('--peer'); });
    tbody.querySelectorAll('tr.peer-row').forEach((tr) => { tr.classList.remove('peer-row'); tr.style.removeProperty('--peer'); });
    for (const p of store.peers()) {
      const target = p.contractId ? { id: p.contractId, key: p.field } : p.view === 'suivi' && p.gridCell ? p.gridCell : null;
      if (!target?.id) continue;
      const r = rows.findIndex((c) => c.id === target.id);
      if (r < 0) continue;
      const tr = tbody.querySelector(`tr[data-id="${CSS.escape(target.id)}"]`);
      if (tr) { tr.classList.add('peer-row'); tr.style.setProperty('--peer', p.color || '#eb6834'); }
      const ci = target.key ? cols.findIndex((c) => c.key === target.key) : -1;
      const td = ci >= 0 ? cellEl(r, ci) : null;
      if (td) { td.classList.add('peer-cell'); td.style.setProperty('--peer', p.color || '#eb6834'); td.setAttribute('data-peer', p.initials || p.name); }
    }
  }

  function paintFlashes() {
    const now = Date.now();
    for (const [k, f] of flashes) {
      if (f.until < now) { flashes.delete(k); continue; }
      const [id, key] = k.split('|');
      const r = rows.findIndex((c) => c.id === id);
      const ci = cols.findIndex((c) => c.key === key);
      const td = r >= 0 && ci >= 0 ? cellEl(r, ci) : null;
      if (td && !td.classList.contains('flash')) { td.classList.add('flash'); if (f.by) td.setAttribute('data-by', f.by.split(' ')[0]); }
    }
  }

  /* ------------------------------------------------------- Statistiques */

  function renderStats() {
    const s = store.state.settings;
    const derived = store.state.derived;
    const signed = rows.filter((c) => derived.get(c.id)?.stage === 'done').length;
    const ca = rows.reduce((a, c) => a + (Number(c.values.ca) || 0), 0);
    let txt = `<strong>${pluralize(rows.length, 'contrat', 'contrats')}</strong>${rows.length !== store.state.list.length ? ` sur ${store.state.list.length}` : ''} · ${signed} signé${signed > 1 ? 's' : ''}${ca ? ` · CA N-1 ${esc(fmtMoneyK(ca))}` : ''}`;
    const b = rangeBounds();
    if (b && (b.r0 !== b.r1 || b.c0 !== b.c1)) {
      let n = 0; let sum = 0; let count = 0;
      for (let r = b.r0; r <= b.r1; r++) {
        for (let c = b.c0; c <= b.c1; c++) {
          count++;
          const col = cols[c];
          const v = rows[r]?.values[col.key];
          if (col.type === 'number' && !isEmpty(v)) { n++; sum += Number(v) || 0; }
        }
      }
      txt += ` <span class="range-stats">· Sélection : ${count} cellules${n ? ` · Somme ${esc(fmtNumber(sum, 2))} · Moyenne ${esc(fmtNumber(sum / n, 1))}` : ''}</span>`;
    }
    stats.innerHTML = txt;
    void s;
  }

  /* -------------------------------------------------- Actions groupées */

  function renderBulk() {
    for (const id of [...selected]) if (!store.getContract(id)) selected.delete(id);
    if (!selected.size) { bulkEl.hidden = true; bulkEl.innerHTML = ''; return; }
    const s = store.state.settings;
    bulkEl.hidden = false;
    const editable = ['statut', 'cm', 'priorite', 'canal'].map((k) => columnByKey(s, k)).filter(Boolean);
    bulkEl.innerHTML = `<span class="bulk-count"><strong>${selected.size}</strong> sélectionné${selected.size > 1 ? 's' : ''}</span>
      ${editable.map((col) => `<button class="btn btn-sm btn-ghost" data-bulk="${esc(col.key)}">${esc(col.label)}${icon('chevronDown')}</button>`).join('')}
      ${columnByKey(s, 'echeance') ? `<button class="btn btn-sm btn-ghost" data-bulk-date="echeance">${icon('calendar')}Échéance</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-act="bulk-export">${icon('download')}Exporter</button>
      <button class="btn btn-sm btn-ghost danger" data-act="bulk-delete">${icon('trash')}Supprimer</button>
      <button class="icon-btn" data-act="bulk-clear" aria-label="Désélectionner" data-tip="Désélectionner">${icon('close')}</button>`;
  }

  bulkEl.addEventListener('click', async (e) => {
    const s = store.state.settings;
    const ids = [...selected];
    const b = e.target.closest('[data-bulk]');
    if (b) {
      const col = columnByKey(s, b.dataset.bulk);
      optionPicker(b, {
        options: optionsForColumn(s, col), value: null, title: `${col.label} pour ${ids.length} contrat(s)`, emptyLabel: 'Effacer la valeur',
        onChange: async (v) => {
          const n = await store.bulkUpdate(ids, { [col.key]: v }, { label: 'Modification groupée' });
          toast(`${n} contrat(s) mis à jour.`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
        },
      });
      return;
    }
    const bd = e.target.closest('[data-bulk-date]');
    if (bd) {
      calendarPopover(bd, {
        value: null, title: `Nouvelle échéance pour ${ids.length} contrat(s)`, marks: milestoneMarks(s),
        onPick: async (v) => {
          const n = await store.bulkUpdate(ids, { [bd.dataset.bulkDate]: v });
          toast(`${n} échéance(s) mise(s) à jour.`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
        },
      });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'bulk-clear') { selected.clear(); render(); }
    if (act === 'bulk-export') exportMenu(e.target.closest('button'), ctx, { ids });
    if (act === 'bulk-delete') {
      const ok = await confirmDialog({ title: `Supprimer ${ids.length} contrat(s) ?`, message: 'Les contrats sélectionnés seront supprimés pour tous les utilisateurs. Vous pourrez annuler juste après (Ctrl+Z).', confirmLabel: 'Supprimer', danger: true });
      if (!ok) return;
      await store.deleteContracts(ids);
      selected.clear();
      toast(`${ids.length} contrat(s) supprimé(s).`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
    }
  });

  /* ------------------------------------------------------------ Édition */

  function startEdit(r, c, { initial = null } = {}) {
    const col = cols[c];
    const contract = rows[r];
    if (!col || !contract) return;
    const td = cellEl(r, c);
    if (!td) return;
    const s = store.state.settings;
    if (col.type === 'computed' || col.readonly) { ctx.openContract(contract.id); return; }
    stopEdit(true);
    setActive(r, c);
    const value = contract.values[col.key];
    store.setPresence({ gridCell: { id: contract.id, key: col.key } });

    if (col.type === 'select' || col.type === 'person' || col.type === 'multiselect') {
      optionPicker(td, {
        options: optionsForColumn(s, col), value, multi: col.type === 'multiselect', title: col.label,
        onChange: (v) => store.updateField(contract.id, col.key, v),
        onClose: () => scroller.focus({ preventScroll: true }),
        allowCreate: col.type !== 'person',
      });
      return;
    }
    if (col.type === 'checkbox') { store.updateField(contract.id, col.key, !value); return; }
    if (col.type === 'date') {
      calendarPopover(td, {
        value, initialText: initial, marks: milestoneMarks(s), title: `${col.label} · ${contract.values.client || ''}`,
        onPick: (v) => store.updateField(contract.id, col.key, v),
        onClose: () => scroller.focus({ preventScroll: true }),
      });
      return;
    }
    if (col.type === 'longtext') {
      const wrap = document.createElement('div');
      wrap.className = 'pop-form pop-text';
      wrap.innerHTML = `<div class="pop-title">${esc(col.label)} · ${esc(contract.values.client || '')}</div><textarea class="input textarea" rows="6"></textarea><div class="pop-actions"><span class="muted small">Ctrl+Entrée pour valider · Échap pour annuler</span><button class="btn btn-sm btn-primary">Enregistrer</button></div>`;
      const ta = wrap.querySelector('textarea');
      ta.value = initial !== null ? initial : value || '';
      let saved = false;
      const save = () => { if (saved) return; saved = true; store.updateField(contract.id, col.key, ta.value.trim() || null); };
      const p = popover(td, wrap, { width: 420, onClose: () => { save(); scroller.focus({ preventScroll: true }); } });
      wrap.querySelector('button').onclick = () => p.close();
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); p.close(); }
        if (e.key === 'Escape') { saved = true; }
      });
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
      return;
    }

    const box = document.createElement('div');
    box.className = 'cell-editor';
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.type = 'text';
    input.value = initial !== null ? initial : col.type === 'number' && !isEmpty(value) ? String(value).replace('.', ',') : value ?? '';
    if (col.type === 'number') input.inputMode = 'decimal';
    box.appendChild(input);
    td.classList.add('editing');
    td.appendChild(box);
    const parse = () => coerceValue(s, col, input.value.trim());
    editing = {
      id: contract.id, key: col.key, el: box, input,
      commit: () => {
        const v = parse();
        if (col.key === 'client' && isEmpty(v)) { toast('Le nom du client est obligatoire.', { type: 'warning' }); return; }
        store.updateField(contract.id, col.key, v);
      },
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); stopEdit(true); move(e.shiftKey ? -1 : 1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); stopEdit(true); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopEdit(false); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); stopEdit(true); move(e.key === 'ArrowUp' ? -1 : 1, 0); }
    });
    input.addEventListener('blur', () => { if (!rerendering && editing?.input === input) stopEdit(true, { refocus: false }); });
    input.focus();
    if (initial === null) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }

  function stopEdit(commit, { refocus = true } = {}) {
    if (!editing) return;
    const e = editing;
    editing = null;
    if (commit) e.commit();
    e.el.parentElement?.classList.remove('editing');
    e.el.remove();
    if (refocus) scroller.focus({ preventScroll: true });
  }

  function move(dr, dc) {
    if (!active) { setActive(0, 0); return; }
    setActive(active.r + dr, active.c + dc);
  }

  /* -------------------------------------------- Copier, couper, coller */

  function copyValue(col, v) {
    if (isEmpty(v)) return '';
    if (col.type === 'number') return String(v).replace('.', ',');
    return displayValue(store.state.settings, { values: { [col.key]: v } }, col);
  }

  function rangeTSV() {
    const b = rangeBounds();
    if (!b) return '';
    const out = [];
    for (let r = b.r0; r <= b.r1; r++) {
      const line = [];
      for (let c = b.c0; c <= b.c1; c++) {
        const col = cols[c];
        const contract = rows[r];
        line.push(col.type === 'computed' ? displayValue(store.state.settings, contract, col, store.state.derived.get(contract.id)) : copyValue(col, contract.values[col.key]));
      }
      out.push(line);
    }
    return toTSV(out);
  }

  async function clearRange() {
    const b = rangeBounds();
    if (!b) return;
    const patches = new Map();
    for (let r = b.r0; r <= b.r1; r++) {
      for (let c = b.c0; c <= b.c1; c++) {
        const col = cols[c];
        if (col.readonly || col.type === 'computed' || col.required) continue;
        const id = rows[r].id;
        if (!patches.has(id)) patches.set(id, {});
        patches.get(id)[col.key] = col.type === 'multiselect' ? [] : col.type === 'checkbox' ? false : null;
      }
    }
    if (!patches.size) return;
    const n = await store.bulkUpdate([...patches.keys()], (c) => patches.get(c.id), { label: 'Effacement', automations: false });
    if (n > 1) toast(`${n} contrat(s) modifié(s).`, { action: { label: 'Annuler', fn: () => store.undo() } });
  }

  async function pasteText(text) {
    const s = store.state.settings;
    let data = parseTSV(text);
    while (data.length && data[data.length - 1].every((x) => x === '')) data.pop();
    if (!data.length) return;
    if (!active) setActive(0, 0);
    const b = rangeBounds();
    const single = data.length === 1 && data[0].length === 1;
    // Une valeur collée sur une plage remplit toute la plage (comme Excel).
    if (single && b && (b.r0 !== b.r1 || b.c0 !== b.c1)) {
      data = Array.from({ length: b.r1 - b.r0 + 1 }, () => Array.from({ length: b.c1 - b.c0 + 1 }, () => data[0][0]));
    }
    const start = b ? { r: b.r0, c: b.c0 } : active;
    const newLists = new Map();
    const unknownPeople = new Set();
    const addMissing = (listKey, value) => {
      if (listKey === '__team__') { unknownPeople.add(value); return null; }
      if (!newLists.has(listKey)) newLists.set(listKey, new Set());
      newLists.get(listKey).add(value);
      return value;
    };
    const patches = new Map();
    const creations = [];
    data.forEach((line, i) => {
      const r = start.r + i;
      const values = {};
      line.forEach((cellText, j) => {
        const col = cols[start.c + j];
        if (!col || col.readonly || col.type === 'computed') return;
        const v = coerceValue(s, col, cellText, { addMissing });
        if (v !== undefined) values[col.key] = v;
      });
      if (!Object.keys(values).length) return;
      if (r < rows.length) patches.set(rows[r].id, values);
      else creations.push(values);
    });
    if (newLists.size) {
      const lists = JSON.parse(JSON.stringify(s.lists));
      for (const [k, vals] of newLists) {
        const list = lists[k] || (lists[k] = []);
        for (const v of vals) if (!list.some((o) => norm(o.value) === norm(v))) list.push({ value: v, color: SWATCHES[list.length % 8] });
      }
      await store.saveSettings({ lists }, 'Valeurs ajoutées par collage');
    }
    if (patches.size) {
      const n = await store.bulkUpdate([...patches.keys()], (c) => patches.get(c.id), { label: 'Collage' });
      toast(`Collage : ${n} contrat(s) mis à jour.`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
    }
    if (creations.length) {
      const named = creations.filter((v) => !isEmpty(v.client));
      if (named.length && await confirmDialog({ title: `Créer ${named.length} nouveau(x) contrat(s) ?`, message: 'Les lignes collées dépassent la fin du tableau. Voulez-vous les ajouter comme nouveaux contrats ?', confirmLabel: 'Créer' })) {
        const res = await store.importContracts(named, { mode: 'append', source: 'Collage' });
        toast(`${res.created} contrat(s) créé(s).`, { type: 'success' });
      } else if (!named.length) toast('Les lignes collées sous le tableau doivent contenir le nom du client pour être créées.', { type: 'warning' });
    }
    if (unknownPeople.size) toast(`Membres inconnus ignorés : ${[...unknownPeople].join(', ')}. Ajoutez-les dans Paramètres › Équipe.`, { type: 'warning', timeout: 7000 });
    const h = data.length; const w = Math.max(...data.map((l) => l.length));
    anchor = { r: start.r, c: start.c };
    active = { r: Math.min(rows.length - 1, start.r + h - 1), c: Math.min(cols.length - 1, start.c + w - 1) };
    paintSelection();
  }

  scroller.addEventListener('copy', (e) => {
    if (editing || !active || e.target.closest('input, textarea')) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', rangeTSV());
    flashRange();
  });
  scroller.addEventListener('cut', (e) => {
    if (editing || !active || e.target.closest('input, textarea')) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', rangeTSV());
    clearRange();
  });
  scroller.addEventListener('paste', (e) => {
    if (editing || e.target.closest('input, textarea')) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  });

  function flashRange() {
    tbody.querySelectorAll('td.in-range, td.active').forEach((td) => { td.classList.remove('copied'); void td.offsetWidth; td.classList.add('copied'); });
  }

  /* ----------------------------------------------------------- Clavier */

  scroller.addEventListener('keydown', (e) => {
    if (editing || e.target !== scroller) return;
    if (!rows.length) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!active && /^Arrow|^Tab$|^Enter$/.test(k)) { e.preventDefault(); setActive(0, 0); return; }
    if (!active) return;
    switch (k) {
      case 'ArrowUp': e.preventDefault(); setActive(ctrl ? 0 : active.r - 1, active.c, { extend: e.shiftKey }); return;
      case 'ArrowDown': e.preventDefault(); setActive(ctrl ? rows.length - 1 : active.r + 1, active.c, { extend: e.shiftKey }); return;
      case 'ArrowLeft': e.preventDefault(); setActive(active.r, ctrl ? 0 : active.c - 1, { extend: e.shiftKey }); return;
      case 'ArrowRight': e.preventDefault(); setActive(active.r, ctrl ? cols.length - 1 : active.c + 1, { extend: e.shiftKey }); return;
      case 'Home': e.preventDefault(); setActive(ctrl ? 0 : active.r, 0, { extend: e.shiftKey }); return;
      case 'End': e.preventDefault(); setActive(ctrl ? rows.length - 1 : active.r, cols.length - 1, { extend: e.shiftKey }); return;
      case 'PageDown': e.preventDefault(); setActive(active.r + 12, active.c, { extend: e.shiftKey }); return;
      case 'PageUp': e.preventDefault(); setActive(active.r - 12, active.c, { extend: e.shiftKey }); return;
      case 'Tab': e.preventDefault(); setActive(active.r, active.c + (e.shiftKey ? -1 : 1)); return;
      case 'Enter':
        e.preventDefault();
        if (ctrl) ctx.openContract(rows[active.r].id); else startEdit(active.r, active.c);
        return;
      case 'F2': e.preventDefault(); startEdit(active.r, active.c); return;
      case 'Escape': anchor = null; paintSelection(); return;
      case 'Delete': case 'Backspace': e.preventDefault(); clearRange(); return;
      case ' ':
        if (cols[active.c]?.type === 'checkbox') { e.preventDefault(); startEdit(active.r, active.c); }
        else if (e.shiftKey) { e.preventDefault(); toggleRow(rows[active.r].id); }
        return;
      default:
        if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); anchor = { r: 0, c: 0 }; active = { r: rows.length - 1, c: cols.length - 1 }; paintSelection(); return; }
        if (!ctrl && !e.altKey && k.length === 1) {
          const col = cols[active.c];
          if (['text', 'number', 'url', 'email', 'longtext', 'date'].includes(col.type) && !col.readonly) { e.preventDefault(); startEdit(active.r, active.c, { initial: k }); }
          else if (['select', 'person', 'multiselect'].includes(col.type)) { e.preventDefault(); startEdit(active.r, active.c); }
        }
    }
  });

  /* ------------------------------------------------------------- Souris */

  function cellFrom(target) {
    const td = target.closest?.('td[data-r]');
    if (!td || !tbody.contains(td)) return null;
    return { td, r: Number(td.dataset.r), c: Number(td.dataset.c) };
  }

  tbody.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('a, input, button, .cell-editor')) return;
    const cell = cellFrom(e.target);
    if (!cell) return;
    const wasActive = active && active.r === cell.r && active.c === cell.c && !anchor;
    if (editing) stopEdit(true, { refocus: false });
    e.preventDefault();
    scroller.focus({ preventScroll: true });
    if (e.shiftKey && active) { setActive(cell.r, cell.c, { extend: true, scroll: false }); return; }
    setActive(cell.r, cell.c, { scroll: false });
    dragSelecting = true;
    const col = cols[cell.c];
    if (wasActive && ['select', 'person', 'multiselect', 'date', 'checkbox'].includes(col.type)) startEdit(cell.r, cell.c);
    else if (col.type === 'checkbox') startEdit(cell.r, cell.c);
  });
  tbody.addEventListener('mouseover', (e) => {
    if (!dragSelecting || !(e.buttons & 1)) return;
    const cell = cellFrom(e.target);
    if (!cell || (active && cell.r === active.r && cell.c === active.c)) return;
    if (!anchor) anchor = { ...active };
    active = { r: cell.r, c: cell.c };
    paintSelection();
  });
  document.addEventListener('mouseup', onMouseUp);
  function onMouseUp() { dragSelecting = false; }

  tbody.addEventListener('dblclick', (e) => {
    if (e.target.closest('a, input, button')) return;
    const cell = cellFrom(e.target);
    if (!cell) return;
    const col = cols[cell.c];
    if (col.type === 'checkbox') return;
    startEdit(cell.r, cell.c);
  });

  function toggleRow(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    const tr = tbody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
    tr?.classList.toggle('selected', selected.has(id));
    const cb = tr?.querySelector('input[data-row]');
    if (cb) cb.checked = selected.has(id);
    const all = thead.querySelector('input[data-act="all"]');
    if (all) all.checked = rows.length > 0 && rows.every((c) => selected.has(c.id));
    renderBulk();
  }

  card.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { e.stopPropagation(); ctx.openContract(open.dataset.open); return; }
    const rowCb = e.target.closest('input[data-row]');
    if (rowCb) { toggleRow(rowCb.dataset.row); return; }
    const allCb = e.target.closest('input[data-act="all"]');
    if (allCb) { if (allCb.checked) rows.forEach((c) => selected.add(c.id)); else selected.clear(); render(); return; }
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) { toggleSort(sortBtn.dataset.sort, e.shiftKey); return; }
    const cf = e.target.closest('[data-colfilter]');
    if (cf) { openColumnFilter(cf, cf.dataset.colfilter); return; }
    const grp = e.target.closest('[data-group]');
    if (grp) {
      const set = new Set(store.state.prefs.collapsedGroups || []);
      if (set.has(grp.dataset.group)) set.delete(grp.dataset.group); else set.add(grp.dataset.group);
      store.setPrefs({ collapsedGroups: [...set] });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add') ctx.newContract();
    if (act === 'import') openImportDialog(ctx);
    if (act === 'clear-filters') { store.setFilters({ search: '', fields: {}, quick: '' }); store.setPrefs({ columnFilters: {} }); }
  });

  function toggleSort(key, multi) {
    let sort = (store.state.prefs.sort || []).slice();
    const i = sort.findIndex((x) => x.key === key);
    if (!multi) {
      const cur = i >= 0 ? sort[i].dir : 0;
      sort = cur === 0 ? [{ key, dir: 1 }] : cur === 1 ? [{ key, dir: -1 }] : [];
    } else if (i < 0) sort.push({ key, dir: 1 });
    else if (sort[i].dir === 1) sort[i] = { key, dir: -1 };
    else sort.splice(i, 1);
    store.setPrefs({ sort });
  }

  /* ------------------------------------------------ Filtre de colonne */

  function filterValue(s, c, col, d) {
    if (col.type === 'multiselect') return (c.values[col.key] || []).join(', ');
    return displayValue(s, c, col, d);
  }

  function openColumnFilter(anchorEl, key) {
    const s = store.state.settings;
    const col = columnByKey(s, key);
    const derived = store.state.derived;
    const base = store.filtered();
    const counts = new Map();
    for (const c of base) {
      const v = filterValue(s, c, col, derived.get(c.id));
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const values = [...counts.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'fr', { numeric: true })));
    const current = store.state.prefs.columnFilters?.[key];
    const checked = new Set(Array.isArray(current) ? current : values);
    const wrap = document.createElement('div');
    wrap.className = 'colfilter';
    wrap.innerHTML = `
      <div class="colfilter-sort">
        <button class="menu-item" data-dir="1">${icon('arrowUp')}<span>Trier par ordre croissant</span></button>
        <button class="menu-item" data-dir="-1">${icon('arrowDown')}<span>Trier par ordre décroissant</span></button>
      </div>
      <div class="picker-search">${icon('search')}<input type="text" placeholder="Rechercher…" aria-label="Rechercher une valeur"></div>
      <label class="colfilter-all"><input type="checkbox" data-all><span>(Tout sélectionner)</span></label>
      <div class="colfilter-list"></div>
      <div class="pop-actions"><button class="btn btn-sm btn-ghost" data-clear>Effacer le filtre</button><button class="btn btn-sm btn-primary" data-ok>OK</button></div>`;
    const listEl = wrap.querySelector('.colfilter-list');
    const search = wrap.querySelector('input[type="text"]');
    const allCb = wrap.querySelector('[data-all]');
    const draw = () => {
      const q = norm(search.value);
      const vis = values.filter((v) => !q || norm(v || '(vides)').includes(q));
      listEl.innerHTML = vis.map((v) => `<label class="colfilter-opt"><input type="checkbox" value="${esc(v)}" ${checked.has(v) ? 'checked' : ''}><span class="clip">${esc(v || '(Vides)')}</span><span class="muted small">${counts.get(v)}</span></label>`).join('') || '<div class="picker-none">Aucune valeur</div>';
      allCb.checked = vis.every((v) => checked.has(v));
    };
    draw();
    search.addEventListener('input', draw);
    listEl.addEventListener('change', (e) => { const cb = e.target; if (cb.checked) checked.add(cb.value); else checked.delete(cb.value); allCb.checked = values.every((v) => checked.has(v)); });
    allCb.addEventListener('change', () => {
      const q = norm(search.value);
      values.filter((v) => !q || norm(v || '(vides)').includes(q)).forEach((v) => (allCb.checked ? checked.add(v) : checked.delete(v)));
      draw();
    });
    const p = popover(anchorEl, wrap, { width: 290, placement: 'bottom-start' });
    wrap.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { store.setPrefs({ sort: [{ key, dir: Number(b.dataset.dir) }] }); p.close(); }));
    wrap.querySelector('[data-clear]').addEventListener('click', () => { const cf = { ...(store.state.prefs.columnFilters || {}) }; delete cf[key]; store.setPrefs({ columnFilters: cf }); p.close(); });
    wrap.querySelector('[data-ok]').addEventListener('click', () => {
      const cf = { ...(store.state.prefs.columnFilters || {}) };
      if (values.every((v) => checked.has(v))) delete cf[key]; else cf[key] = [...checked];
      store.setPrefs({ columnFilters: cf });
      p.close();
    });
    search.focus();
  }

  /* -------------------------------------------- Redimensionnement */

  thead.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-resize]');
    if (!h) return;
    e.preventDefault();
    const key = h.dataset.resize;
    const col = columnByKey(store.state.settings, key);
    const startX = e.clientX;
    const startW = widthOf(col);
    const colEl = colgroup.querySelector(`col[data-key="${CSS.escape(key)}"]`);
    let w = startW;
    h.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const onMove = (ev) => {
      w = Math.max(60, Math.min(600, startW + ev.clientX - startX));
      colEl.style.width = `${w}px`;
      table.style.width = `${SEL_W + cols.reduce((a, c) => a + (c.key === key ? w : widthOf(c)), 0)}px`;
    };
    const onUp = () => {
      h.removeEventListener('pointermove', onMove);
      h.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing');
      store.setPrefs({ columnWidths: { ...(store.state.prefs.columnWidths || {}), [key]: Math.round(w) } });
    };
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
  });
  thead.addEventListener('dblclick', (e) => {
    const h = e.target.closest('[data-resize]');
    if (!h) return;
    const widths = { ...(store.state.prefs.columnWidths || {}) };
    delete widths[h.dataset.resize];
    store.setPrefs({ columnWidths: widths });
  });

  /* -------------------------------------------- Barre d'outils */

  fb.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = store.state.settings;
    const act = b.dataset.act;
    if (act === 'group') {
      const cur = store.state.prefs.groupBy;
      menu(b, [
        { header: 'Regrouper les lignes par' },
        { label: 'Aucun regroupement', checked: !cur, onClick: () => store.setPrefs({ groupBy: '' }) },
        ...GROUPABLE.map((k) => columnByKey(s, k)).filter(Boolean).map((col) => ({ label: col.label, checked: cur === col.key, onClick: () => store.setPrefs({ groupBy: col.key, collapsedGroups: [] }) })),
      ]);
    }
    if (act === 'columns') openColumnsMenu(b);
    if (act === 'density') store.setPrefs({ density: store.state.prefs.density === 'compact' ? 'comfortable' : 'compact' });
    if (act === 'import') openImportDialog(ctx);
    if (act === 'export') exportMenu(b, ctx, {});
  });

  function openColumnsMenu(anchorEl) {
    const s = store.state.settings;
    const wrap = document.createElement('div');
    wrap.className = 'colmenu';
    const draw = () => {
      const hidden = store.state.prefs.hiddenColumns || s.columns.filter((c) => c.hidden).map((c) => c.key);
      wrap.innerHTML = `<div class="picker-title">Colonnes affichées (pour vous)</div>
        <div class="colmenu-list">${s.columns.map((c) => `<label class="colfilter-opt"><input type="checkbox" value="${esc(c.key)}" ${hidden.includes(c.key) ? '' : 'checked'} ${c.key === 'client' ? 'disabled' : ''}><span>${esc(c.label)}</span></label>`).join('')}</div>
        <div class="pop-actions"><button class="btn btn-sm btn-ghost" data-reset>Affichage par défaut</button><a class="btn btn-sm btn-secondary" href="#/parametres/colonnes">Gérer les colonnes</a></div>`;
    };
    draw();
    wrap.addEventListener('change', (e) => {
      const hidden = new Set(store.state.prefs.hiddenColumns || s.columns.filter((c) => c.hidden).map((c) => c.key));
      if (e.target.checked) hidden.delete(e.target.value); else hidden.add(e.target.value);
      store.setPrefs({ hiddenColumns: [...hidden] });
    });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-reset]')) { store.setPrefs({ hiddenColumns: null, columnWidths: {} }); draw(); } });
    popover(anchorEl, wrap, { width: 280, placement: 'bottom-end' });
  }

  /* -------------------------------------------- Mise à jour */

  function applyDensity() { card.classList.toggle('compact', store.state.prefs.density === 'compact'); }
  applyDensity();
  render();
  scroller.addEventListener('focus', () => { if (!active && rows.length) setActive(0, 1, { scroll: false }); });

  const schedule = (() => {
    let t = null;
    return () => { if (t) return; t = requestAnimationFrame(() => { t = null; render(); }); };
  })();

  return {
    update(evt, payload) {
      if (evt === 'data') {
        for (const r of payload?.remote || []) for (const k of r.keys || []) flashes.set(`${r.id}|${k}`, { until: Date.now() + 2600, by: r.by });
        schedule();
      }
      if (evt === 'remote') schedule();
      if (evt === 'settings') schedule();
      if (evt === 'prefs') { fb.update(); applyDensity(); schedule(); }
      if (evt === 'presence') paintPresence();
    },
    route({ params }) { void params; },
    unmount() {
      document.removeEventListener('mouseup', onMouseUp);
      stopEdit(true, { refocus: false });
      ctx.navIds = null;
    },
  };
}

export const _test = { debounce };
