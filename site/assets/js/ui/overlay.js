// Couches superposées : notifications, fenêtres modales, confirmations, menus, popovers, infobulles.

import { icon } from './icons.js';
import { esc } from '../core/utils.js';

function root(id) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
  return el;
}

/* ---------------------------------------------------------------- Toasts */

const TOAST_ICON = { info: 'info', success: 'checkCircle', error: 'alertCircle', warning: 'alert', remote: 'users' };

export function toast(message, { type = 'info', action = null, timeout = 4500, html = false } = {}) {
  const host = root('toast-root');
  host.setAttribute('aria-live', 'polite');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(TOAST_ICON[type] || 'info', 'toast-ico')}<div class="toast-msg"></div>${action ? `<button class="toast-action" type="button">${esc(action.label)}</button>` : ''}<button class="toast-close" type="button" aria-label="Fermer">${icon('close')}</button>`;
  const msg = el.querySelector('.toast-msg');
  if (html) msg.innerHTML = message; else msg.textContent = message;
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.toast-close').onclick = close;
  if (action) el.querySelector('.toast-action').onclick = () => { close(); action.fn(); };
  host.appendChild(el);
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
  return close;
}

/* ---------------------------------------------------------------- Modales */

const openModals = [];

export function modal({ title = '', body = '', size = 'md', actions = [], onClose = null, dismissible = true, className = '' } = {}) {
  const host = root('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-${size} ${className}" role="dialog" aria-modal="true" aria-labelledby="m-title-${openModals.length}">
      <header class="modal-head">
        <h2 class="modal-title" id="m-title-${openModals.length}"></h2>
        ${dismissible ? `<button class="icon-btn modal-x" type="button" aria-label="Fermer">${icon('close')}</button>` : ''}
      </header>
      <div class="modal-body"></div>
      ${actions.length ? '<footer class="modal-foot"></footer>' : ''}
    </div>`;
  const dialog = backdrop.querySelector('.modal');
  backdrop.querySelector('.modal-title').textContent = title;
  const bodyEl = backdrop.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const previousFocus = document.activeElement;
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.classList.add('leaving');
    setTimeout(() => backdrop.remove(), 160);
    openModals.splice(openModals.indexOf(api), 1);
    document.removeEventListener('keydown', onKey, true);
    if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
    onClose?.(result);
  };
  const foot = backdrop.querySelector('.modal-foot');
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-${a.kind || 'secondary'}`;
    if (a.id) b.id = a.id;
    b.innerHTML = `${a.icon ? icon(a.icon) : ''}<span></span>`;
    b.querySelector('span').textContent = a.label;
    b.onclick = async () => {
      if (a.onClick) {
        b.disabled = true;
        try {
          const keep = await a.onClick(close, b);
          if (keep === false) { b.disabled = false; return; }
        } catch (err) { b.disabled = false; toast(err.message || String(err), { type: 'error' }); return; }
      }
      close(a.value);
    };
    foot.appendChild(b);
  }
  function onKey(e) {
    if (openModals[openModals.length - 1] !== api) return;
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const f = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  if (dismissible) {
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.modal-x').onclick = () => close();
  }
  host.appendChild(backdrop);
  const api = { el: dialog, bodyEl, close, footEl: foot };
  openModals.push(api);
  requestAnimationFrame(() => {
    const target = dialog.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select, .modal-foot .btn-primary');
    (target || dialog.querySelector('.modal-x') || dialog).focus?.({ preventScroll: true });
  });
  return api;
}

export function confirmDialog({ title = 'Confirmer', message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false, typed = '', html = false } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.className = 'confirm-body';
    const p = document.createElement('div');
    p.className = 'confirm-msg';
    if (html) p.innerHTML = message; else p.textContent = message;
    body.appendChild(p);
    let input = null;
    if (typed) {
      const lab = document.createElement('label');
      lab.className = 'field';
      lab.innerHTML = `<span class="field-label">Pour confirmer, saisissez <strong>${esc(typed)}</strong></span><input class="input" type="text" autocomplete="off">`;
      input = lab.querySelector('input');
      body.appendChild(lab);
    }
    let result = false;
    const m = modal({
      title, body, size: 'sm',
      actions: [
        { label: cancelLabel, kind: 'ghost' },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', id: 'confirm-ok', onClick: () => { if (input && input.value.trim() !== typed) { input.focus(); input.classList.add('invalid'); return false; } result = true; return true; } },
      ],
      onClose: () => resolve(result),
    });
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') m.footEl.querySelector('#confirm-ok').click(); });
  });
}

export function promptDialog({ title = '', label = '', value = '', placeholder = '', confirmLabel = 'Valider', type = 'text' } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('label');
    body.className = 'field';
    body.innerHTML = `<span class="field-label"></span><input class="input" type="${type}" autocomplete="off">`;
    body.querySelector('.field-label').textContent = label;
    const input = body.querySelector('input');
    input.value = value; input.placeholder = placeholder;
    let result = null;
    const m = modal({
      title, body, size: 'sm',
      actions: [
        { label: 'Annuler', kind: 'ghost' },
        { label: confirmLabel, kind: 'primary', id: 'prompt-ok', onClick: () => { result = input.value; } },
      ],
      onClose: () => resolve(result),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); m.footEl.querySelector('#prompt-ok').click(); } });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* --------------------------------------------------------------- Popovers */

let currentPopover = null;

export function closePopover() { currentPopover?.close(); }

export function popover(anchor, content, { placement = 'bottom-start', className = '', onClose = null, onEscape = null, width = null, focus = true } = {}) {
  closePopover();
  const host = root('popover-root');
  const el = document.createElement('div');
  el.className = `popover ${className}`;
  el.setAttribute('role', 'dialog');
  if (width) el.style.width = typeof width === 'number' ? `${width}px` : width;
  if (typeof content === 'string') el.innerHTML = content; else el.appendChild(content);
  host.appendChild(el);
  const reposition = () => {
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth; const ph = el.offsetHeight;
    const vw = window.innerWidth; const vh = window.innerHeight;
    let left = placement.endsWith('end') ? r.right - pw : r.left;
    let top = placement.startsWith('top') ? r.top - ph - 6 : r.bottom + 6;
    if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;
    if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8);
    left = Math.max(8, Math.min(left, vw - pw - 8));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  };
  reposition();
  let closed = false;
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onEscape?.(); close(); anchor.focus?.({ preventScroll: true }); } };
  const onScroll = (e) => { if (!el.contains(e.target)) close(); };
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', onScroll, true);
    if (currentPopover === api) currentPopover = null;
    onClose?.();
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('scroll', onScroll, true);
  }, 0);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  const api = { el, close, reposition };
  currentPopover = api;
  if (focus) requestAnimationFrame(() => el.querySelector('input, [data-autofocus], button')?.focus({ preventScroll: true }));
  return api;
}

/**
 * Menu déroulant. items : [{ label, icon, onClick, danger, disabled, checked, hint, divider, header }]
 */
export function menu(anchor, items, opts = {}) {
  const ul = document.createElement('div');
  ul.className = 'menu';
  ul.setAttribute('role', 'menu');
  items.forEach((it) => {
    if (it.divider) { const d = document.createElement('div'); d.className = 'menu-divider'; ul.appendChild(d); return; }
    if (it.header) { const d = document.createElement('div'); d.className = 'menu-header'; d.textContent = it.header; ul.appendChild(d); return; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`;
    b.setAttribute('role', it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
    if (it.checked !== undefined) b.setAttribute('aria-checked', String(!!it.checked));
    b.disabled = !!it.disabled;
    b.innerHTML = `<span class="menu-ico">${it.checked ? icon('check') : it.icon ? icon(it.icon) : ''}</span><span class="menu-label"></span>${it.hint ? '<span class="menu-hint"></span>' : ''}`;
    b.querySelector('.menu-label').textContent = it.label;
    if (it.hint) b.querySelector('.menu-hint').textContent = it.hint;
    b.onclick = () => { if (!it.keepOpen) p.close(); it.onClick?.(); };
    ul.appendChild(b);
  });
  ul.addEventListener('keydown', (e) => {
    const btns = [...ul.querySelectorAll('.menu-item:not(:disabled)')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  });
  const p = popover(anchor, ul, { className: 'popover-menu', ...opts });
  return p;
}

/* ------------------------------------------------------------ Infobulles */

let tipEl = null;
let tipTarget = null;

function showTip(target) {
  const text = target.getAttribute('data-tip');
  if (!text) return;
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tooltip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
  tipEl.textContent = text;
  tipEl.classList.add('show');
  const r = target.getBoundingClientRect();
  const w = tipEl.offsetWidth; const h = tipEl.offsetHeight;
  let top = r.top - h - 8;
  if (top < 6) top = r.bottom + 8;
  const left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6));
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
  tipTarget = target;
}

function hideTip() { tipEl?.classList.remove('show'); tipTarget = null; }

export function installTooltips() {
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t && t !== tipTarget) showTip(t); else if (!t && tipTarget) hideTip();
  });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);
  document.addEventListener('mousedown', hideTip, true);
}
