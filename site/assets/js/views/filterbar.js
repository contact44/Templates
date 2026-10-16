// Barre de filtres commune (tableau de bord, suivi, pipeline, échéancier) :
// recherche, filtres par champ et raccourcis. Les filtres s'appliquent à toutes les vues.

import { icon } from '../ui/icons.js';
import { optionPicker, optionsForColumn } from '../ui/components.js';
import { QUICK_VIEWS } from '../core/compute.js';
import { columnByKey } from '../core/schema.js';
import { debounce, esc } from '../core/utils.js';

const DIMENSIONS = ['cm', 'statut', 'division', 'canal', 'priorite'];

export function filterBar(ctx, { quick = true, extra = '' } = {}) {
  const { store } = ctx;
  const el = document.createElement('div');
  el.className = 'filterbar';

  function render() {
    const s = store.state.settings;
    const f = store.state.prefs.filters;
    const dims = DIMENSIONS.map((k) => columnByKey(s, k)).filter(Boolean);
    const activeCount = Object.values(f.fields || {}).filter((v) => v?.length).length + (f.search ? 1 : 0) + (f.quick ? 1 : 0);
    const quickHTML = quick ? `<div class="quick" role="tablist" aria-label="Raccourcis">${QUICK_VIEWS.map((q) => `<button type="button" role="tab" class="quick-btn${(f.quick || '') === q.id ? ' active' : ''}" aria-selected="${(f.quick || '') === q.id}" data-quick="${q.id}">${esc(q.label)}</button>`).join('')}</div>` : '';
    const extraHTML = extra ? `<div class="filterbar-extra">${extra}</div>` : '';
    el.innerHTML = `
      <div class="filterbar-row">
        <label class="search">${icon('search')}<input type="search" placeholder="Rechercher un client, une référence, une action…" aria-label="Rechercher" value="${esc(f.search || '')}"><kbd>/</kbd></label>
        <div class="filter-dims">
          ${dims.map((col) => {
            const vals = f.fields?.[col.key] || [];
            const label = vals.length === 1 ? valueLabel(s, col, vals[0]) : vals.length ? `${col.label} · ${vals.length}` : col.label;
            return `<button type="button" class="filter-btn${vals.length ? ' on' : ''}" data-dim="${esc(col.key)}" aria-haspopup="listbox">${esc(label)}${icon('chevronDown')}</button>`;
          }).join('')}
          ${activeCount ? `<button type="button" class="link-btn reset" data-act="reset">${icon('close')}Réinitialiser</button>` : ''}
        </div>
        ${quick ? '' : extraHTML}
      </div>
      ${quick ? `<div class="filterbar-row second">${quickHTML}${extraHTML}</div>` : ''}`;
  }

  function valueLabel(s, col, v) {
    if (v === '__empty__') return `${col.label} : non renseigné`;
    if (col.type === 'person') return store.member(v)?.name || v;
    return v;
  }

  const setSearch = debounce((v) => store.setFilters({ search: v }), 180);
  el.addEventListener('input', (e) => { if (e.target.matches('input[type="search"]')) setSearch(e.target.value); });
  el.addEventListener('click', (e) => {
    const dimBtn = e.target.closest('[data-dim]');
    if (dimBtn) {
      const col = columnByKey(store.state.settings, dimBtn.dataset.dim);
      const current = store.state.prefs.filters.fields?.[col.key] || [];
      optionPicker(dimBtn, {
        options: [...optionsForColumn(store.state.settings, col), { value: '__empty__', label: col.type === 'person' ? 'Non assigné' : 'Non renseigné', color: 'transparent' }],
        value: current, multi: true, title: `Filtrer : ${col.label}`,
        onChange: (vals) => store.setFilters({ fields: { ...store.state.prefs.filters.fields, [col.key]: vals } }),
      });
      return;
    }
    const q = e.target.closest('[data-quick]');
    if (q) {
      if (q.dataset.quick === 'mine' && !store.meMember()) {
        ctx.toastIdentity?.();
      }
      store.setFilters({ quick: q.dataset.quick });
      return;
    }
    if (e.target.closest('[data-act="reset"]')) store.setFilters({ search: '', fields: {}, quick: '' });
  });

  render();
  return {
    el,
    update() {
      const input = el.querySelector('input[type="search"]');
      const hadFocus = document.activeElement === input;
      const pos = input?.selectionStart;
      render();
      if (hadFocus) { const i = el.querySelector('input[type="search"]'); i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* type search */ } }
    },
  };
}

/** Résumé lisible des filtres actifs (pour les en-têtes et les exports). */
export function filtersActive(store) {
  const f = store.state.prefs.filters;
  return !!(f.search || f.quick || Object.values(f.fields || {}).some((v) => v?.length));
}
