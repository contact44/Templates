// Composants d'affichage réutilisés : pastilles, avatars, barres d'avancement, alertes,
// rendu d'une cellule, sélecteur de valeurs, champs de formulaire.

import { icon } from './icons.js';
import { popover } from './overlay.js';
import { LEVEL_LABEL } from '../core/compute.js';
import { listOptions, memberById, STAGES } from '../core/schema.js';
import {
  addDays, esc, fmtDate, inkOn, fmtDateTime, fmtNumber, fmtRelative, initials, isEmpty, norm, parseDateInput, todayISO, diffDays,
  startOfWeek, weekday,
} from '../core/utils.js';

export function avatar(member, { size = 'sm', title = true } = {}) {
  if (!member) return `<span class="avatar avatar-${size} avatar-empty" ${title ? 'data-tip="Non assigné"' : ''}>${icon('user')}</span>`;
  const ini = member.initials || initials(member.name);
  const bg = member.color || '#1428a0';
  return `<span class="avatar avatar-${size}" style="--c:${esc(bg)};color:${inkOn(bg)}" ${title ? `data-tip="${esc(member.name)}"` : ''}>${esc(ini.slice(0, 3))}</span>`;
}

export function optionColor(settings, listKey, value) {
  return listOptions(settings, listKey).find((o) => o.value === value)?.color || '#a3a7af';
}

export function chip(label, color, { cls = '', title = '' } = {}) {
  if (isEmpty(label)) return '';
  return `<span class="chip ${cls}" style="--c:${esc(color)}"${title ? ` data-tip="${esc(title)}"` : ''}><span class="chip-dot"></span><span class="chip-label">${esc(label)}</span></span>`;
}

export function optionChip(settings, listKey, value, opts) {
  return chip(value, optionColor(settings, listKey, value), opts);
}

export function tagsHTML(settings, listKey, values, { max = 0 } = {}) {
  if (!Array.isArray(values) || !values.length) return '';
  const shown = max && values.length > max ? values.slice(0, max) : values;
  const more = values.length - shown.length;
  return `<span class="tags"${more ? ` data-tip="${esc(values.join(', '))}"` : ''}>${shown.map((v) => `<span class="tag" style="--c:${esc(optionColor(settings, listKey, v))}">${esc(v)}</span>`).join('')}${more ? `<span class="tag tag-more">+${more}</span>` : ''}</span>`;
}

export function personHTML(settings, id, { compact = false } = {}) {
  if (isEmpty(id)) return '';
  const m = memberById(settings, id);
  if (!m) return `<span class="person">${avatar({ name: String(id), color: '#8d9099' })}<span class="person-name">${esc(id)}</span></span>`;
  return `<span class="person">${avatar(m)}${compact ? '' : `<span class="person-name">${esc(m.name)}</span>`}</span>`;
}

export function progressHTML(progress, stage) {
  if (stage === 'blocked') return `<span class="progress-label is-blocked">${icon('pause')}Bloqué</span>`;
  if (stage === 'cancelled') return '<span class="progress-label muted">Abandonné</span>';
  const p = Math.max(0, Math.min(100, Number(progress) || 0));
  return `<span class="progress" role="img" aria-label="Avancement ${p} %"><span class="progress-track"><span class="progress-fill${p === 100 ? ' done' : ''}" style="width:${p}%"></span></span><span class="progress-num">${p} %</span></span>`;
}

const LEVEL_ICON = { critical: 'alertCircle', serious: 'alert', warning: 'clock', info: 'info' };

export function levelIcon(level, cls = '') {
  return `<span class="lvl lvl-${level} ${cls}">${icon(LEVEL_ICON[level] || 'info')}</span>`;
}

export function alertsBadge(alerts) {
  if (!alerts || !alerts.length) return '<span class="ok-mark" data-tip="Aucune alerte">' + icon('check') + '</span>';
  const top = alerts[0].level;
  const tip = alerts.map((a) => `• ${a.label}`).join('\n');
  return `<span class="alert-badge lvl-${top}" data-tip="${esc(tip)}">${icon(LEVEL_ICON[top])}<span>${alerts.length > 1 ? `${alerts.length} alertes` : esc(LEVEL_LABEL[top])}</span></span>`;
}

export function alertList(alerts) {
  if (!alerts.length) return '';
  return `<ul class="alert-list">${alerts.map((a) => `<li class="alert-item lvl-${a.level}">${levelIcon(a.level)}<span>${esc(a.label)}</span></li>`).join('')}</ul>`;
}

export function stageColor(stageId) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const s = STAGES.find((x) => x.id === stageId) || STAGES[0];
  return dark ? s.darkColor : s.color;
}

/** Contenu HTML d'une cellule (tableau, cartes). */
export function cellHTML(settings, contract, col, derived, { today = todayISO() } = {}) {
  const v = contract.values[col.key];
  switch (col.type) {
    case 'select':
      return col.list ? optionChip(settings, col.list, v) : esc(v ?? '');
    case 'multiselect':
      return tagsHTML(settings, col.list, v, { max: 1 });
    case 'person':
      return personHTML(settings, v);
    case 'date': {
      if (isEmpty(v)) return '';
      let cls = '';
      if (col.key === 'echeance' && derived && derived.stage !== 'done' && derived.stage !== 'cancelled') {
        const d = diffDays(today, v);
        if (d < 0) cls = 'date-late'; else if (d <= (settings.alerts?.dueSoonDays ?? 7)) cls = 'date-soon';
      }
      return `<span class="date ${cls}">${cls === 'date-late' ? icon('alert') : ''}${esc(fmtDate(v))}</span>`;
    }
    case 'number':
      return isEmpty(v) ? '' : `<span class="num">${esc(fmtNumber(v, 2))}</span>`;
    case 'url':
      return isEmpty(v) ? '' : `<a class="cell-link" href="${esc(safeUrl(v))}" target="_blank" rel="noopener noreferrer" data-tip="${esc(v)}">${icon('external')}<span>Ouvrir</span></a>`;
    case 'email':
      return isEmpty(v) ? '' : `<a class="cell-link" href="mailto:${esc(v)}">${esc(v)}</a>`;
    case 'checkbox':
      return `<span class="checkmark${v ? ' on' : ''}" role="checkbox" aria-checked="${v ? 'true' : 'false'}">${v ? icon('check') : ''}</span>`;
    case 'longtext':
      return isEmpty(v) ? '' : `<span class="clip" data-tip="${esc(v)}">${esc(v)}</span>`;
    case 'computed': {
      if (col.computed === 'progress') return derived ? progressHTML(derived.progress, derived.stage) : '';
      if (col.computed === 'alerts') return derived ? alertsBadge(derived.alerts) : '';
      if (col.computed === 'updated') {
        return contract.updatedAt ? `<span class="updated" data-tip="${esc(fmtDateTime(contract.updatedAt))}${contract.updatedByName ? ` – ${esc(contract.updatedByName)}` : ''}">${esc(fmtRelative(contract.updatedAt))}${contract.updatedByName ? ` · ${esc(contract.updatedByName.split(' ')[0])}` : ''}</span>` : '';
      }
      return '';
    }
    default:
      return isEmpty(v) ? '' : `<span class="clip">${esc(v)}</span>`;
  }
}

export function safeUrl(v) {
  const s = String(v || '').trim();
  if (/^(https?:|mailto:|file:|\\\\)/i.test(s)) return s;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s}`;
  return '#';
}

/* ------------------------------------------------- Sélecteur de valeurs */

/**
 * Liste de choix avec recherche et clavier.
 * options : [{ value, label, color, member }] ; multi : choix multiples.
 * onChange(value) est appelé à chaque choix (valeur unique, ou tableau en mode multiple).
 */
export function optionPicker(anchor, { options, value, multi = false, onChange, allowEmpty = true, emptyLabel = 'Aucune valeur', title = '', onClose, allowCreate = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  const selected = new Set(multi ? (Array.isArray(value) ? value : []) : isEmpty(value) ? [] : [value]);
  wrap.innerHTML = `
    ${title ? `<div class="picker-title">${esc(title)}</div>` : ''}
    <div class="picker-search">${icon('search')}<input type="text" placeholder="Rechercher…" aria-label="Rechercher une valeur"></div>
    <div class="picker-list" role="listbox" ${multi ? 'aria-multiselectable="true"' : ''}></div>
    ${multi ? '<div class="picker-foot"><button type="button" class="btn btn-sm btn-ghost" data-act="clear">Tout effacer</button><button type="button" class="btn btn-sm btn-primary" data-act="done">Terminé</button></div>' : ''}`;
  const input = wrap.querySelector('input');
  const listEl = wrap.querySelector('.picker-list');
  let active = 0;
  let visible = [];

  function render() {
    const q = norm(input.value);
    visible = options.filter((o) => !q || norm(o.label ?? o.value).includes(q));
    const rows = [];
    if (!multi && allowEmpty && !q) rows.push({ value: null, label: emptyLabel, empty: true });
    rows.push(...visible);
    if (allowCreate && q && !options.some((o) => norm(o.value) === q)) rows.push({ value: input.value.trim(), label: `Ajouter « ${input.value.trim()} »`, create: true });
    visible = rows;
    active = Math.min(active, Math.max(0, rows.length - 1));
    listEl.innerHTML = rows.map((o, i) => {
      const isSel = o.empty ? selected.size === 0 : selected.has(o.value);
      const lead = o.member ? avatar(o.member, { title: false }) : o.empty ? `<span class="picker-empty-dot"></span>` : o.create ? icon('plus') : `<span class="chip-dot" style="--c:${esc(o.color || '#a3a7af')}"></span>`;
      return `<div class="picker-opt${i === active ? ' active' : ''}${isSel ? ' selected' : ''}${o.empty ? ' is-empty' : ''}" role="option" aria-selected="${isSel}" data-i="${i}">${multi ? `<span class="cbox">${isSel ? icon('check') : ''}</span>` : ''}${lead}<span class="picker-label">${esc(o.label ?? o.value)}</span>${!multi && isSel ? icon('check', 'picker-check') : ''}</div>`;
    }).join('') || '<div class="picker-none">Aucun résultat</div>';
    listEl.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const o = visible[i];
    if (!o) return;
    if (multi) {
      if (selected.has(o.value)) selected.delete(o.value); else selected.add(o.value);
      if (o.create) { options = [...options, { value: o.value, color: '#a3a7af', created: true }]; input.value = ''; }
      onChange?.([...selected], o);
      render();
    } else {
      onChange?.(o.empty ? null : o.value, o);
      p.close();
    }
  }

  listEl.addEventListener('mousedown', (e) => e.preventDefault());
  listEl.addEventListener('click', (e) => { const el = e.target.closest('.picker-opt'); if (el) choose(Number(el.dataset.i)); });
  listEl.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.picker-opt');
    if (el && Number(el.dataset.i) !== active) { active = Number(el.dataset.i); listEl.querySelectorAll('.picker-opt').forEach((x) => x.classList.toggle('active', Number(x.dataset.i) === active)); }
  });
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(visible.length - 1, active + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    if (e.key === 'Tab') { p.close(); }
  });
  wrap.querySelector('[data-act="clear"]')?.addEventListener('click', () => { selected.clear(); onChange?.([]); render(); });
  wrap.querySelector('[data-act="done"]')?.addEventListener('click', () => p.close());
  if (!multi) {
    const idx = options.findIndex((o) => o.value === value);
    active = idx >= 0 ? idx + (allowEmpty ? 1 : 0) : 0;
  }
  render();
  const p = popover(anchor, wrap, { className: 'popover-picker', onClose, width: 300 });
  input.focus();
  return p;
}

export function optionsForColumn(settings, col) {
  if (col.type === 'person') return (settings.team || []).map((m) => ({ value: m.id, label: m.name, member: m }));
  return listOptions(settings, col.list).map((o) => ({ value: o.value, label: o.value, color: o.color }));
}


/* ------------------------------------------------------- Calendrier */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Sélecteur de date en français (jj/mm/aaaa) : saisie libre en haut (« 1/12 », « +7 », « demain »…)
 * et calendrier mensuel. onPick(iso|null). marks : [{ date, label, tone }] affichés sous forme de points.
 */
export function calendarPopover(anchor, { value = null, onPick, onClose, withInput = true, initialText = null, marks = [], title = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'cal';
  const today = todayISO();
  let view = (value || today).slice(0, 7);
  let focus = value || today;
  let picked = false;
  wrap.innerHTML = `
    ${title ? `<div class="picker-title">${esc(title)}</div>` : ''}
    ${withInput ? `<div class="cal-input"><input class="input" type="text" inputmode="numeric" placeholder="jj/mm/aaaa" aria-label="Date (jj/mm/aaaa)" autocomplete="off"><span class="cal-hint">Entrée pour valider · « +7 » = dans 7 jours</span></div>` : ''}
    <div class="cal-head"><button type="button" class="icon-btn" data-nav="-1" aria-label="Mois précédent">${icon('chevronLeft')}</button><strong class="cal-title" aria-live="polite"></strong><button type="button" class="icon-btn" data-nav="1" aria-label="Mois suivant">${icon('chevronRight')}</button></div>
    <div class="cal-grid" role="grid"></div>
    <div class="cal-foot"><button type="button" class="chip-btn" data-act="today">Aujourd’hui</button><button type="button" class="chip-btn" data-act="week">+ 7 jours</button><span></span><button type="button" class="link-btn" data-act="clear">Effacer</button></div>`;
  const input = wrap.querySelector('.cal-input input');
  if (input) input.value = initialText !== null ? initialText : value ? fmtDate(value) : '';
  const grid = wrap.querySelector('.cal-grid');
  const markMap = new Map(marks.filter((m) => m.date).map((m) => [m.date, m]));

  function pick(iso) {
    picked = true;
    p.close();
    onPick?.(iso);
  }

  function render() {
    const [y, m] = view.split('-').map(Number);
    wrap.querySelector('.cal-title').textContent = `${MONTHS[m - 1]} ${y}`;
    const first = `${view}-01`;
    const start = startOfWeek(first);
    const days = [];
    for (let i = 0; i < 42; i++) days.push(addDays(start, i));
    grid.innerHTML = `<div class="cal-row cal-wd">${['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map((d) => `<span>${d}</span>`).join('')}</div>`
      + [0, 1, 2, 3, 4, 5].map((r) => `<div class="cal-row" role="row">${days.slice(r * 7, r * 7 + 7).map((d) => {
        const mk = markMap.get(d);
        const cls = [d.slice(0, 7) !== view ? 'out' : '', d === today ? 'today' : '', d === value ? 'sel' : '', d === focus ? 'focus' : '', weekday(d) === 0 || weekday(d) === 6 ? 'we' : ''].filter(Boolean).join(' ');
        return `<button type="button" role="gridcell" class="cal-day ${cls}" data-d="${d}" tabindex="${d === focus ? 0 : -1}" aria-label="${esc(fmtDate(d, 'long'))}${mk ? ` – ${esc(mk.label)}` : ''}" ${mk ? `data-tip="${esc(mk.label)}"` : ''}>${Number(d.slice(8))}${mk ? `<span class="cal-mark tone-${esc(mk.tone || 'brand')}"></span>` : ''}</button>`;
      }).join('')}</div>`).join('');
  }

  function moveFocus(n) {
    focus = addDays(focus, n);
    if (focus.slice(0, 7) !== view) view = focus.slice(0, 7);
    render();
    grid.querySelector('.cal-day.focus')?.focus();
  }

  wrap.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const [y, m] = view.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.nav), 1));
      view = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      render();
      return;
    }
    const day = e.target.closest('[data-d]');
    if (day) { pick(day.dataset.d); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'today') pick(today);
    if (act === 'week') pick(addDays(value && value > today ? value : today, 7));
    if (act === 'clear') pick(null);
  });
  grid.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); }
    if (k === 'ArrowRight') { e.preventDefault(); moveFocus(1); }
    if (k === 'ArrowUp') { e.preventDefault(); moveFocus(-7); }
    if (k === 'ArrowDown') { e.preventDefault(); moveFocus(7); }
    if (k === 'PageUp') { e.preventDefault(); moveFocus(-28); }
    if (k === 'PageDown') { e.preventDefault(); moveFocus(28); }
  });
  input?.addEventListener('input', () => {
    const iso = parseDateInput(input.value);
    input.classList.toggle('invalid', !!input.value.trim() && !iso);
    if (iso) { focus = iso; view = iso.slice(0, 7); render(); }
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = input.value.trim();
      if (!t) { pick(null); return; }
      const iso = parseDateInput(t);
      if (iso) pick(iso); else input.classList.add('invalid');
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); grid.querySelector('.cal-day.focus')?.focus(); }
  });
  render();
  const p = popover(anchor, wrap, { className: 'popover-cal', width: 300, focus: false, onClose: () => { onClose?.(picked); } });
  setTimeout(() => {
    if (input) { input.focus(); if (initialText !== null) input.setSelectionRange(input.value.length, input.value.length); else input.select(); } else grid.querySelector('.cal-day.focus')?.focus();
  }, 0);
  return p;
}

/** Champ date français : saisie jj/mm/aaaa + bouton calendrier. */
export function dateField(value, onCommit, { ariaLabel = 'Date', marks = [] } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'date-field';
  wrap.innerHTML = `<input class="input" type="text" inputmode="numeric" placeholder="jj/mm/aaaa" autocomplete="off" aria-label="${esc(ariaLabel)}"><button type="button" class="date-btn" aria-label="Ouvrir le calendrier" data-tip="Calendrier">${icon('calendar')}</button>`;
  const inp = wrap.querySelector('input');
  let current = value || null;
  inp.value = current ? fmtDate(current) : '';
  const commit = (iso) => {
    inp.classList.remove('invalid');
    inp.value = iso ? fmtDate(iso) : '';
    if ((iso || null) === (current || null)) return;
    current = iso || null;
    onCommit(current);
  };
  inp.addEventListener('change', () => {
    const t = inp.value.trim();
    if (!t) { commit(null); return; }
    const iso = parseDateInput(t);
    if (iso) commit(iso); else inp.classList.add('invalid');
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.dispatchEvent(new Event('change')); }
    if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); }
  });
  const open = () => calendarPopover(wrap, { value: current, withInput: false, marks, onPick: (iso) => commit(iso) });
  wrap.querySelector('.date-btn').addEventListener('click', open);
  wrap.input = inp;
  wrap.setValue = (v) => { current = v || null; if (document.activeElement !== inp) { inp.value = current ? fmtDate(current) : ''; inp.classList.remove('invalid'); } };
  return wrap;
}

export function milestoneMarks(settings) {
  return (settings.milestones || []).map((m) => ({ date: m.date, label: m.label, tone: m.role === 'signature' ? 'critical' : m.role === 'cgv' ? 'brand' : 'muted' }));
}

/* ------------------------------------------------ Champs de formulaire */

/**
 * Champ éditable pour la fiche contrat. onCommit(value) est appelé quand la valeur change.
 * Retourne un élément DOM ; el.setValue(v) met à jour l'affichage sans déclencher onCommit.
 */
export function fieldControl(settings, col, value, onCommit, { readonly = false, ctx = {} } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `fc fc-${col.type}`;
  wrap.dataset.key = col.key;
  let current = value;

  const commit = (v) => {
    if (JSON.stringify(v ?? null) === JSON.stringify(current ?? null)) return;
    current = v;
    onCommit(v);
  };

  if (readonly || col.readonly || col.type === 'computed') {
    wrap.classList.add('fc-readonly');
    wrap.innerHTML = col.type === 'computed' ? cellHTML(settings, ctx.contract || { values: {} }, col, ctx.derived) : `<span class="fc-text">${esc(value ?? '') || '<span class="muted">—</span>'}</span>`;
    wrap.setValue = (v) => { current = v; wrap.innerHTML = col.type === 'computed' ? cellHTML(settings, ctx.contract || { values: {} }, col, ctx.derived) : `<span class="fc-text">${esc(v ?? '') || '<span class="muted">—</span>'}</span>`; };
    return wrap;
  }

  switch (col.type) {
    case 'longtext': {
      const ta = document.createElement('textarea');
      ta.className = 'input textarea';
      ta.rows = 2;
      ta.value = value ?? '';
      ta.placeholder = 'Ajouter…';
      const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(260, ta.scrollHeight + 2)}px`; };
      ta.addEventListener('input', fit);
      ta.addEventListener('blur', () => commit(ta.value.trim() || null));
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ta.blur(); if (e.key === 'Escape') { ta.value = current ?? ''; ta.blur(); } });
      wrap.appendChild(ta);
      requestAnimationFrame(fit);
      wrap.setValue = (v) => { current = v; if (document.activeElement !== ta) { ta.value = v ?? ''; fit(); } };
      break;
    }
    case 'date': {
      const df = dateField(value, (v) => commit(v), { ariaLabel: col.label, marks: milestoneMarks(settings) });
      wrap.appendChild(df);
      wrap.setValue = (v) => { current = v; df.setValue(v); };
      break;
    }
    case 'select': case 'person': case 'multiselect': {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'input fc-pick';
      const paint = () => {
        let inner = '';
        if (col.type === 'person') inner = personHTML(settings, current);
        else if (col.type === 'multiselect') inner = tagsHTML(settings, col.list, current);
        else inner = optionChip(settings, col.list, current);
        btn.innerHTML = `${inner || '<span class="muted">Choisir…</span>'}${icon('chevronDown', 'fc-caret')}`;
      };
      paint();
      btn.addEventListener('click', () => {
        optionPicker(btn, {
          options: optionsForColumn(settings, col),
          value: current,
          multi: col.type === 'multiselect',
          title: col.label,
          onChange: (v) => { commit(v); paint(); },
        });
      });
      wrap.appendChild(btn);
      wrap.setValue = (v) => { current = v; paint(); };
      break;
    }
    case 'checkbox': {
      const lab = document.createElement('label');
      lab.className = 'switch';
      lab.innerHTML = `<input type="checkbox"><span class="switch-track"><span class="switch-thumb"></span></span><span class="switch-text"></span>`;
      const inp = lab.querySelector('input');
      inp.checked = !!value;
      lab.querySelector('.switch-text').textContent = value ? 'Oui' : 'Non';
      inp.addEventListener('change', () => { lab.querySelector('.switch-text').textContent = inp.checked ? 'Oui' : 'Non'; commit(inp.checked); });
      wrap.appendChild(lab);
      wrap.setValue = (v) => { current = v; inp.checked = !!v; lab.querySelector('.switch-text').textContent = v ? 'Oui' : 'Non'; };
      break;
    }
    default: {
      const row = document.createElement('div');
      row.className = 'fc-line';
      const inp = document.createElement('input');
      inp.className = 'input';
      inp.type = col.type === 'email' ? 'email' : 'text';
      if (col.type === 'number') inp.inputMode = 'decimal';
      inp.value = col.type === 'number' && !isEmpty(value) ? String(value).replace('.', ',') : value ?? '';
      inp.placeholder = col.type === 'url' ? 'https://…' : col.type === 'number' ? '0' : '';
      const parse = () => {
        const t = inp.value.trim();
        if (!t) return null;
        if (col.type === 'number') { const n = Number(t.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : current; }
        return t;
      };
      inp.addEventListener('change', () => commit(parse()));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = current ?? ''; inp.blur(); } });
      row.appendChild(inp);
      if (col.type === 'url') {
        const a = document.createElement('a');
        a.className = 'icon-btn';
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.innerHTML = icon('external');
        a.setAttribute('data-tip', 'Ouvrir le lien');
        const upd = () => { a.href = safeUrl(current); a.hidden = isEmpty(current); };
        upd();
        inp.addEventListener('change', upd);
        row.appendChild(a);
        wrap.updateLink = upd;
      }
      wrap.appendChild(row);
      wrap.setValue = (v) => {
        current = v;
        if (document.activeElement !== inp) inp.value = col.type === 'number' && !isEmpty(v) ? String(v).replace('.', ',') : v ?? '';
        wrap.updateLink?.();
      };
    }
  }
  return wrap;
}

export function emptyState({ iconName = 'sheet', title, text = '', actions = '' }) {
  return `<div class="empty"><div class="empty-ico">${icon(iconName)}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
}
