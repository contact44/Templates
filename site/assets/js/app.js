// Coquille de l'application : navigation, barre supérieure, routage, raccourcis clavier,
// notifications des modifications faites par les autres utilisateurs.

import { icon } from './ui/icons.js';
import { SAMSUNG_LOGO } from './ui/logo.js';
import { avatar } from './ui/components.js';
import { closePopover, confirmDialog, menu, modal, promptDialog, toast } from './ui/overlay.js';
import { columnByKey } from './core/schema.js';
import { esc, fmtCountdown, fmtDate, fmtNumber, throttle } from './core/utils.js';
import { kpis } from './core/compute.js';
import { openContract, closeContract, updateDrawer, currentContractId } from './views/drawer.js';

import * as dashboardView from './views/dashboard.js';
import * as tableView from './views/table.js';
import * as boardView from './views/board.js';
import * as planningView from './views/planning.js';
import * as journalView from './views/journal.js';
import * as settingsView from './views/settings.js';


export const ROUTES = [
  { id: 'tableau-de-bord', label: 'Tableau de bord', icon: 'dashboard', view: dashboardView, subtitle: 'Vue d’ensemble de la saison' },
  { id: 'suivi', label: 'Suivi des contrats', icon: 'table', view: tableView, subtitle: 'Tableau de suivi, modifiable à plusieurs en temps réel' },
  { id: 'pipeline', label: 'Pipeline', icon: 'board', view: boardView, subtitle: 'Contrats par statut, à faire glisser d’une colonne à l’autre' },
  { id: 'echeancier', label: 'Échéancier', icon: 'calendar', view: planningView, subtitle: 'Prochaines actions et calendrier de la saison' },
  { id: 'journal', label: 'Journal', icon: 'history', view: journalView, subtitle: 'Historique de toutes les modifications' },
  { id: 'parametres', label: 'Paramètres', icon: 'settings', view: settingsView, subtitle: 'Saison, équipe, listes, colonnes, import et export' },
];

export function startApp(root, store, { config }) {
  const backend = store.state.backend;
  let current = null;
  let currentRoute = null;

  root.innerHTML = `
    <a class="skip-link" href="#main">Aller au contenu</a>
    <div class="shell">
      <aside class="sidebar" id="sidebar" aria-label="Navigation principale">
        <div class="brand">
          <a class="brand-logo" href="#/tableau-de-bord" aria-label="Accueil">${SAMSUNG_LOGO}</a>
          <div class="brand-sub"><span class="brand-app">Legal</span><span class="brand-season" id="brand-season"></span></div>
        </div>
        <nav class="nav">${ROUTES.map((r) => `<a class="nav-item" href="#/${r.id}" data-route="${r.id}">${icon(r.icon)}<span class="nav-label">${esc(r.label)}</span><span class="nav-badge" data-badge="${r.id}"></span></a>`).join('')}</nav>
        <div class="sidebar-foot" id="sidebar-foot"></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main-col">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="Ouvrir le menu">${icon('menu')}</button>
          <div class="topbar-title"><h1 id="page-title"></h1><p id="page-sub"></p></div>
          <div class="topbar-right">
            <div class="sync" id="sync" role="status" aria-live="polite"></div>
            <div class="presence" id="presence"></div>
            <button class="icon-btn" id="undo-btn" data-tip="Annuler (Ctrl+Z)" aria-label="Annuler" disabled>${icon('undo')}</button>
            <button class="icon-btn" id="redo-btn" data-tip="Rétablir (Ctrl+Y)" aria-label="Rétablir" disabled>${icon('redo')}</button>
            <button class="icon-btn" id="theme-btn" data-tip="Thème clair / sombre" aria-label="Changer de thème">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button>
            <button class="btn btn-primary" id="new-btn">${icon('plus')}<span>Nouveau contrat</span></button>
            <button class="user-btn" id="user-btn" aria-label="Mon compte"></button>
          </div>
        </header>
        <div id="banner"></div>
        <main class="content" id="main" tabindex="-1"></main>
      </div>
    </div>
    <div id="drawer-root"></div>`;

  const $ = (sel) => root.querySelector(sel);
  const mainEl = $('#main');

  const ctx = {
    store,
    config,
    openContract: (id, opts) => openContract(ctx, id, opts),
    navigate: (path) => { location.hash = `#/${path}`; },
    newContract,
    refreshChrome: () => { renderChrome(); },
  };

  /* --------------------------------------------------------- Routage */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const [routeId, sub] = path.split('/');
    const params = new URLSearchParams(query);
    return { routeId: routeId || store.state.prefs.lastView || 'tableau-de-bord', sub, params };
  }

  function route() {
    const { routeId, sub, params } = parseHash();
    const r = ROUTES.find((x) => x.id === routeId) || ROUTES[0];
    if (!current || currentRoute !== r) {
      closePopover();
      current?.unmount?.();
      mainEl.innerHTML = '';
      mainEl.scrollTop = 0;
      currentRoute = r;
      current = r.view.mount(mainEl, ctx, { sub, params });
      store.setPrefs({ lastView: r.id }, { silent: true });
      root.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === r.id));
      root.querySelectorAll('.nav-item').forEach((a) => (a.dataset.route === r.id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
      $('#page-title').textContent = r.label;
      $('#page-sub').textContent = r.subtitle;
      document.title = `${r.label} · ${store.state.settings.season.name}`;
      store.setPresence({ view: r.id, contractId: null, field: null });
      document.body.classList.remove('nav-open');
    } else {
      current.route?.({ sub, params });
    }
    const c = params.get('c');
    if (c && c !== currentContractId()) openContract(ctx, c, { fromRoute: true });
    if (!c && currentContractId()) closeContract({ fromRoute: true });
  }

  window.addEventListener('hashchange', route);

  /* -------------------------------------------------------- Habillage */

  function renderChrome() {
    const s = store.state.settings;
    $('#brand-season').textContent = s.season.name;
    const k = kpis(s, store.state.list, store.state.derived, store.state.today);
    const counts = { suivi: k.live, echeancier: k.overdueActions };
    for (const el of root.querySelectorAll('[data-badge]')) {
      const id = el.dataset.badge;
      const n = counts[id];
      el.textContent = n ? fmtNumber(n) : '';
      el.classList.toggle('alert', id === 'echeancier' && n > 0);
      if (id === 'echeancier' && n) el.setAttribute('data-tip', `${n} action(s) en retard`); else el.removeAttribute('data-tip');
    }
    const sig = k.signatureMilestone;
    $('#sidebar-foot').innerHTML = `
      <div class="season-card">
        <div class="season-card-top"><span class="season-card-label">Date butoir</span><span class="season-card-count">${sig ? esc(fmtCountdown(k.daysToSignature)) : '—'}</span></div>
        <div class="season-card-date">${sig ? esc(fmtDate(sig.date, 'long')) : 'Non définie'}</div>
        <div class="meter" role="img" aria-label="${k.signed} contrats signés sur ${k.live}"><span class="meter-fill" style="width:${Math.round(k.signedPct * 100)}%"></span></div>
        <div class="season-card-foot"><strong>${k.signed}</strong> / ${k.live} signés · ${Math.round(k.signedPct * 100)} %</div>
      </div>
      <div class="mode-pill ${backend.kind}">${icon(backend.kind === 'local' ? 'database' : 'cloud')}<span>${backend.kind === 'local' ? 'Mode local' : 'Base partagée'}</span></div>`;
    renderUser();
    renderUndo();
  }

  function renderUser() {
    const me = store.me();
    $('#user-btn').innerHTML = avatar({ name: me.name, color: me.color, initials: me.initials }, { size: 'md', title: false });
    $('#user-btn').setAttribute('data-tip', me.name);
  }

  function renderUndo() {
    $('#undo-btn').disabled = !store.canUndo();
    $('#redo-btn').disabled = !store.canRedo();
  }

  const SYNC = {
    connecting: ['refresh', 'Connexion…', 'spin'],
    synced: ['cloudCheck', 'Synchronisé', 'ok'],
    saving: ['refresh', 'Enregistrement…', 'spin'],
    offline: ['cloudOff', 'Hors ligne – modifications conservées', 'warn'],
    local: ['database', 'Enregistré dans ce navigateur', 'local'],
    error: ['alertCircle', 'Erreur de synchronisation', 'err'],
  };

  function renderSync() {
    const [ic, label, cls] = SYNC[store.state.sync.status] || SYNC.connecting;
    const el = $('#sync');
    el.className = `sync sync-${cls}`;
    el.innerHTML = `${icon(ic)}<span class="sync-label">${esc(label)}</span>`;
    el.setAttribute('data-tip', label);
  }

  function renderPresence() {
    const peers = store.peers();
    const me = store.me();
    const el = $('#presence');
    if (backend.kind === 'local') { el.innerHTML = ''; return; }
    const viewLabel = (p) => ROUTES.find((r) => r.id === p.view)?.label || '';
    const contractLabel = (p) => (p.contractId ? store.getContract(p.contractId)?.values.client : '');
    el.innerHTML = `<span class="presence-label">${peers.length ? `${peers.length + 1} en ligne` : 'Seul en ligne'}</span>
      ${peers.map((p) => `<span class="presence-av" data-tip="${esc(`${p.name} — ${contractLabel(p) ? `fiche ${contractLabel(p)}` : viewLabel(p)}`)}">${avatar({ name: p.name, color: p.color, initials: p.initials }, { title: false })}<span class="online-dot"></span></span>`).join('')}
      <span class="presence-av me" data-tip="${esc(`${me.name} (vous)`)}">${avatar({ name: me.name, color: me.color, initials: me.initials }, { title: false })}<span class="online-dot"></span></span>`;
  }

  function renderBanner() {
    const el = $('#banner');
    if (config.preview) {
      el.innerHTML = `<div class="banner banner-info">${icon('info')}<span><strong>Aperçu</strong> avec des données fictives : vos modifications restent dans ce navigateur. En ligne, avec Firebase configuré, les contract managers modifient les mêmes données en temps réel.</span></div>`;
    } else if (backend.kind === 'local' && !sessionStorageGet('hideLocalBanner')) {
      el.innerHTML = `<div class="banner banner-warn">${icon('database')}<span><strong>Mode local :</strong> les données sont enregistrées dans ce navigateur uniquement et ne sont pas partagées. Pour travailler à plusieurs en temps réel, configurez Firebase (voir le guide de mise en ligne).</span><button class="icon-btn" aria-label="Masquer" id="banner-x">${icon('close')}</button></div>`;
      el.querySelector('#banner-x').onclick = () => { sessionStorageSet('hideLocalBanner', '1'); el.innerHTML = ''; };
    } else el.innerHTML = '';
  }

  /* ---------------------------------------------------------- Actions */

  async function newContract(values = {}) {
    const name = values.client ? values.client : await promptDialog({ title: 'Nouveau contrat', label: 'Client / enseigne', placeholder: 'Nom du client', confirmLabel: 'Créer le contrat' });
    if (name === null || name === undefined) return null;
    if (!String(name).trim()) { toast('Le nom du client est obligatoire.', { type: 'warning' }); return null; }
    const id = await store.createContract({ ...values, client: String(name).trim() });
    toast(`Contrat « ${String(name).trim()} » créé.`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
    openContract(ctx, id);
    return id;
  }

  $('#new-btn').addEventListener('click', () => newContract());
  $('#undo-btn').addEventListener('click', doUndo);
  $('#redo-btn').addEventListener('click', doRedo);
  $('#theme-btn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.setPrefs({ theme: next });
  });
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

  $('#user-btn').addEventListener('click', (e) => {
    const me = store.me();
    const team = store.state.settings.team || [];
    const items = [
      { header: me.email ? `${me.name} · ${me.email}` : me.name },
      { label: 'Qui suis-je dans l’équipe ?', icon: 'user', onClick: chooseIdentity },
    ];
    if (backend.kind === 'firebase') {
      items.push({ label: 'Changer mon mot de passe', icon: 'key', onClick: changePassword });
      items.push({ divider: true });
      items.push({ label: 'Se déconnecter', icon: 'logout', onClick: async () => { await backend.signOut(); location.reload(); } });
    }
    if (!team.length) items.splice(1, 1);
    menu(e.currentTarget, items, { placement: 'bottom-end' });
  });

  function chooseIdentity() {
    const team = store.state.settings.team || [];
    const body = document.createElement('div');
    body.className = 'identity-list';
    body.innerHTML = `<p class="muted">Sélectionnez votre nom : le filtre « Mes contrats » et vos initiales dans le journal s’appuient sur ce choix.${backend.kind === 'firebase' ? ' Astuce : renseignez votre e-mail dans Paramètres › Équipe pour que la correspondance soit automatique.' : ''}</p>
      ${team.map((m) => `<button class="identity-opt${store.meMember()?.id === m.id ? ' selected' : ''}" data-id="${esc(m.id)}">${avatar(m, { title: false })}<span><strong>${esc(m.name)}</strong><span class="muted small">${esc(m.role || '')}</span></span></button>`).join('')}`;
    const mdl = modal({ title: 'Qui suis-je ?', body, size: 'sm' });
    body.addEventListener('click', (ev) => {
      const b = ev.target.closest('.identity-opt');
      if (!b) return;
      store.setPrefs({ meId: b.dataset.id });
      backend.setDisplayName?.(store.member(b.dataset.id)?.name);
      mdl.close();
      renderChrome();
      store.emit('data', { reason: 'identity' });
      toast(`Vous êtes identifié(e) comme ${store.member(b.dataset.id)?.name}.`, { type: 'success' });
    });
  }

  async function changePassword() {
    const body = document.createElement('form');
    body.className = 'form-grid';
    body.innerHTML = `<label class="field"><span class="field-label">Mot de passe actuel</span><input class="input" type="password" name="cur" autocomplete="current-password" required></label>
      <label class="field"><span class="field-label">Nouveau mot de passe (8 caractères minimum)</span><input class="input" type="password" name="next" autocomplete="new-password" minlength="8" required></label>`;
    modal({
      title: 'Changer mon mot de passe', body, size: 'sm',
      actions: [{ label: 'Annuler', kind: 'ghost' }, {
        label: 'Enregistrer', kind: 'primary', onClick: async () => {
          const cur = body.cur.value; const next = body.next.value;
          if (next.length < 8) { toast('Le nouveau mot de passe doit contenir au moins 8 caractères.', { type: 'warning' }); return false; }
          try { await backend.changePassword(cur, next); toast('Mot de passe modifié.', { type: 'success' }); return true; } catch (err) { toast(authError(err), { type: 'error' }); return false; }
        },
      }],
    });
  }

  async function doUndo() {
    const label = await store.undo();
    if (label) toast(`${label} annulée.`, { timeout: 2500 });
  }
  async function doRedo() {
    const label = await store.redo();
    if (label) toast(`${label} rétablie.`, { timeout: 2500 });
  }

  document.addEventListener('keydown', (e) => {
    const inField = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !inField) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    }
    if (e.key === '/' && !inField && !document.querySelector('.modal-backdrop')) {
      const s = document.querySelector('.filterbar input[type="search"]');
      if (s) { e.preventDefault(); s.focus(); }
    }
  });

  /* -------------------------------------------- Évènements du magasin */

  const throttledChrome = throttle(renderChrome, 400);
  store.on('data', (payload) => {
    current?.update?.('data', payload);
    updateDrawer(ctx, 'data', payload);
    throttledChrome();
  });
  store.on('settings', () => { current?.update?.('settings'); });
  store.on('comments', () => { current?.update?.('comments'); updateDrawer(ctx, 'comments'); });
  store.on('history', () => { current?.update?.('history'); updateDrawer(ctx, 'history'); });
  store.on('presence', () => { renderPresence(); current?.update?.('presence'); updateDrawer(ctx, 'presence'); });
  store.on('sync', renderSync);
  store.on('prefs', (patch) => current?.update?.('prefs', patch));
  store.on('undo', renderUndo);
  store.on('user', () => { renderUser(); renderPresence(); });
  store.on('error', ({ message }) => toast(message, { type: 'error', timeout: 7000 }));
  store.on('automation', ({ id, values }) => {
    const c = store.getContract(id);
    const parts = Object.entries(values).map(([k, v]) => {
      const col = columnByKey(store.state.settings, k);
      return `${col?.label || k} : ${col?.type === 'date' ? fmtDate(v) : v}`;
    });
    toast(`Mise à jour automatique${c ? ` (${c.values.client})` : ''} — ${parts.join(', ')}`, { type: 'info', timeout: 4000 });
  });

  // Regroupe les modifications des collègues dans une notification discrète.
  let pendingRemote = [];
  const flushRemote = throttle(() => {
    if (!pendingRemote.length) return;
    const byUser = new Map();
    for (const r of pendingRemote) {
      const who = r.by || 'Un collègue';
      if (!byUser.has(who)) byUser.set(who, new Set());
      const c = store.getContract(r.id);
      if (c) byUser.get(who).add(c.values.client || c.values.ref);
    }
    pendingRemote = [];
    for (const [who, clients] of byUser) {
      if (!clients.size) continue;
      const list = [...clients];
      toast(`${who} a modifié ${list.length > 2 ? `${list.length} contrats` : list.join(' et ')}.`, { type: 'remote', timeout: 3500 });
    }
  }, 3000);
  store.on('remote', (list) => {
    current?.update?.('remote', list);
    pendingRemote.push(...list);
    flushRemote();
  });

  renderChrome();
  renderSync();
  renderPresence();
  renderBanner();
  route();
  if (!location.hash) history.replaceState(null, '', `#/${parseHash().routeId}`);
  return ctx;
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* indisponible */ } }

export function authError(err) {
  const code = String(err?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) return 'Adresse e-mail ou mot de passe incorrect.';
  if (code.includes('too-many-requests')) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (code.includes('network')) return 'Connexion impossible. Vérifiez votre accès à Internet.';
  if (code.includes('weak-password')) return 'Mot de passe trop faible (8 caractères minimum).';
  if (code.includes('requires-recent-login')) return 'Reconnectez-vous puis recommencez.';
  return err?.message || 'Une erreur est survenue.';
}

export { confirmDialog };
