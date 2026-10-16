// Coquille de l'application : navigation, barre supérieure, routage, raccourcis clavier,
// notifications des modifications faites par les autres utilisateurs.

import { icon } from './ui/icons.js';
import { SAMSUNG_LOGO } from './ui/logo.js';
import { readHash, writeHash } from './ui/nav.js';
import { avatar } from './ui/components.js';
import { closePopover, confirmDialog, menu, modal, promptDialog, toast } from './ui/overlay.js';
import { columnByKey } from './core/schema.js';
import { esc, fmtCountdown, fmtDate, fmtNumber, throttle } from './core/utils.js';
import { kpis } from './core/compute.js';
import { openContract, closeContract, updateDrawer, currentContractId } from './views/drawer.js';
import { accessLink } from './core/backend-github.js';

import * as dashboardView from './views/dashboard.js';
import * as accountsView from './views/accounts.js';
import * as accountView from './views/account.js';
import * as tableView from './views/table.js';
import * as reportGenView from './views/report-gen.js';
import * as reportDivView from './views/report-div.js';
import * as hebdoView from './views/hebdo.js';
import * as journalView from './views/journal.js';
import * as settingsView from './views/settings.js';
import { accountKey } from './core/compute.js';

export const ROUTES = [
  { id: 'accueil', label: 'Tableau de bord', icon: 'dashboard', view: dashboardView, subtitle: 'La situation de la saison en un coup d’œil' },
  { id: 'comptes', label: 'Comptes clients', icon: 'users', view: accountsView, subtitle: 'Chaque client, ses divisions et leur avancement' },
  { id: 'compte', label: 'Comptes clients', icon: 'users', view: accountView, subtitle: 'Fiche du compte client', hidden: true, nav: 'comptes' },
  { id: 'reporting', label: 'Reporting général', icon: 'layers', view: reportGenView, subtitle: 'Synthèse, tableau et graphique par division (FR / EN)' },
  { id: 'divisions', label: 'Reporting par division', icon: 'target', view: reportDivView, subtitle: 'Avancement d’une division, d’un CM ou d’un juriste' },
  { id: 'hebdo', label: 'Suivi hebdo', icon: 'mail', view: hebdoView, subtitle: 'Avancement semaine par semaine et e-mail du vendredi' },
  { id: 'journal', label: 'Journal', icon: 'history', view: journalView, subtitle: 'Historique de toutes les modifications' },
  { id: 'parametres', label: 'Paramètres', icon: 'settings', view: settingsView, subtitle: 'Saison, équipe, étapes et listes, import et partage' },
  { id: 'tableur', label: 'Vue tableur', icon: 'table', view: tableView, subtitle: 'Toutes les colonnes du fichier Suivi CM, pour une saisie en masse', hidden: true, nav: 'comptes' },
  { id: 'suivi', label: 'Vue tableur', icon: 'table', view: tableView, subtitle: 'Toutes les colonnes du fichier Suivi CM, pour une saisie en masse', hidden: true, nav: 'comptes' },
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
          <a class="brand-logo" href="#/accueil" aria-label="Accueil">${SAMSUNG_LOGO}</a>
          <div class="brand-sub"><span class="brand-app">Legal</span><span class="brand-season" id="brand-season"></span></div>
        </div>
        <nav class="nav">${ROUTES.filter((r) => !r.hidden).map((r) => `<a class="nav-item" href="#/${r.id}" data-route="${r.id}">${icon(r.icon)}<span class="nav-label">${esc(r.label)}</span><span class="nav-badge" data-badge="${r.id}"></span></a>`).join('')}</nav>
        <div class="sidebar-foot" id="sidebar-foot"></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main-col">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="Ouvrir le menu">${icon('menu')}</button>
          <div class="topbar-title"><h1 id="page-title"></h1><p id="page-sub"></p><p class="print-meta" id="print-meta"></p></div>
          <div class="topbar-right">
            <div class="sync" id="sync" role="status" aria-live="polite"></div>
            <div class="presence" id="presence"></div>
            <button class="icon-btn" id="undo-btn" data-tip="Annuler (Ctrl+Z)" aria-label="Annuler" disabled>${icon('undo')}</button>
            <button class="icon-btn" id="redo-btn" data-tip="Rétablir (Ctrl+Y)" aria-label="Rétablir" disabled>${icon('redo')}</button>
            <button class="icon-btn" id="theme-btn" data-tip="Thème clair / sombre" aria-label="Changer de thème">${icon('moon', 'only-light')}${icon('sun', 'only-dark')}</button>
            <button class="btn btn-primary" id="new-btn">${icon('plus')}<span>Nouveau compte</span></button>
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
  // Faux si l'interface a été remplacée (ex. écran « accès non autorisé ») : plus aucun rendu.
  const alive = () => mainEl.isConnected;

  const ctx = {
    store,
    config,
    openContract: (id, opts) => openContract(ctx, id, opts),
    navigate: (path) => go(`#/${path}`),
    replaceRoute: (path) => writeHash(`#/${path}`, { replace: true }),
    newContract,
    refreshChrome: () => { renderChrome(); },
  };

  /* --------------------------------------------------------- Routage */

  function go(hash, opts) {
    writeHash(hash, opts);
    route();
  }

  function parseHash() {
    const raw = readHash().replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const [routeId, sub] = path.split('/');
    const params = new URLSearchParams(query);
    return { routeId: routeId || store.state.prefs.lastView || 'accueil', sub, params };
  }

  let pendingContract = null;
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
      const navId = r.nav || r.id;
      root.querySelectorAll('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === navId));
      root.querySelectorAll('.nav-item').forEach((a) => (a.dataset.route === navId ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
      $('#page-title').textContent = r.label;
      $('#page-sub').textContent = r.subtitle;
      document.title = `${r.label} · ${store.state.settings.season.name}`;
      store.setPresence({ view: r.id, contractId: null, field: null });
      document.body.classList.remove('nav-open');
    } else {
      current.route?.({ sub, params });
    }
    const c = params.get('c');
    // Lien direct vers une fiche : avec la base partagée, les contrats arrivent après l'affichage de la page.
    pendingContract = c && !store.getContract(c) && !store.state.loaded.contracts ? c : null;
    if (c && c !== currentContractId() && !pendingContract) openContract(ctx, c, { fromRoute: true });
    if (!c && currentContractId()) closeContract({ fromRoute: true });
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  // Les liens internes passent par le routeur (fonctionne aussi dans un aperçu intégré).
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });

  /* -------------------------------------------------------- Habillage */

  function renderChrome() {
    if (!alive()) return;
    const s = store.state.settings;
    $('#brand-season').textContent = s.season.name;
    $('#print-meta').textContent = `${s.season.name}${s.season.entity ? ` · ${s.season.entity}` : ''} · imprimé le ${fmtDate(store.state.today, 'long')}`;
    const k = kpis(s, store.state.list, store.state.derived, store.state.today);
    const clients = new Set(store.state.list.filter((c) => !store.state.derived.get(c.id)?.closed && c.values.client).map((c) => accountKey(c.values.client)));
    const counts = { comptes: clients.size };
    for (const el of root.querySelectorAll('[data-badge]')) {
      const n = counts[el.dataset.badge];
      el.textContent = n ? fmtNumber(n) : '';
    }
    const sig = k.signatureMilestone;
    const pending = backend.pendingCount?.() || 0;
    $('#sidebar-foot').innerHTML = `
      <div class="season-card">
        <div class="season-card-top"><span class="season-card-label">Date butoir</span><span class="season-card-count">${sig ? esc(fmtCountdown(k.daysToSignature)) : '—'}</span></div>
        <div class="season-card-date">${sig ? esc(fmtDate(sig.date, 'long')) : 'Non définie'}</div>
        <div class="meter" role="img" aria-label="${k.signes} PAF signés sur ${k.attendus}"><span class="meter-fill" style="width:${Math.round(k.signedPct * 100)}%"></span></div>
        <div class="season-card-foot"><strong>${k.signes}</strong> / ${k.attendus} signés · ${Math.round(k.signedPct * 100)} %</div>
      </div>
      <div class="mode-pill ${backend.kind}" ${backend.kind === 'github' ? `data-tip="${esc(backend.label)}${pending ? ` · ${pending} modification(s) en attente d’envoi` : ''}"` : ''}>${icon(backend.kind === 'local' ? 'database' : 'cloud')}<span>${backend.kind === 'local' ? 'Mode local' : 'Base partagée GitHub'}</span></div>`;
    renderUser();
    renderUndo();
  }

  function renderUser() {
    if (!alive()) return;
    const me = store.me();
    $('#user-btn').innerHTML = avatar({ name: me.name, color: me.color, initials: me.initials }, { size: 'md', title: false });
    $('#user-btn').setAttribute('data-tip', me.name);
  }

  function renderUndo() {
    if (!alive()) return;
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
    if (!alive()) return;
    const [ic, label, cls] = SYNC[store.state.sync.status] || SYNC.connecting;
    const el = $('#sync');
    el.className = `sync sync-${cls}`;
    el.innerHTML = `${icon(ic)}<span class="sync-label">${esc(label)}</span>`;
    el.setAttribute('data-tip', label);
  }

  function renderPresence() {
    if (!alive()) return;
    const peers = store.peers();
    const me = store.me();
    const el = $('#presence');
    if (backend.kind === 'local' || !peers.length) { el.innerHTML = ''; return; } // présence : seulement si le stockage la fournit
    const viewLabel = (p) => ROUTES.find((r) => r.id === p.view)?.label || '';
    const contractLabel = (p) => (p.contractId ? store.getContract(p.contractId)?.values.client : '');
    el.innerHTML = `<span class="presence-label">${peers.length ? `${peers.length + 1} en ligne` : 'Seul en ligne'}</span>
      ${peers.map((p) => `<span class="presence-av" data-tip="${esc(`${p.name} — ${contractLabel(p) ? `fiche ${contractLabel(p)}` : viewLabel(p)}`)}">${avatar({ name: p.name, color: p.color, initials: p.initials }, { title: false })}<span class="online-dot"></span></span>`).join('')}
      <span class="presence-av me" data-tip="${esc(`${me.name} (vous)`)}">${avatar({ name: me.name, color: me.color, initials: me.initials }, { title: false })}<span class="online-dot"></span></span>`;
  }

  function renderBanner() {
    if (!alive()) return;
    const el = $('#banner');
    if (config.preview) {
      el.innerHTML = `<div class="banner banner-info">${icon('info')}<span class="long"><strong>Aperçu</strong> ${config.previewData ? 'avec les données de votre fichier' : 'avec des données fictives'} : vos modifications restent dans ce navigateur. En ligne, toute l’équipe modifie les mêmes données en temps réel, enregistrées dans un dépôt GitHub.</span><span class="short"><strong>Aperçu</strong> · ${config.previewData ? 'vos données' : 'données fictives'}</span></div>`;
    } else if (backend.kind === 'local' && !sessionStorageGet('hideLocalBanner')) {
      el.innerHTML = `<div class="banner banner-warn">${icon('database')}<span class="long"><strong>Mode local :</strong> les données sont enregistrées dans ce navigateur uniquement et ne sont pas partagées. Pour travailler à plusieurs en temps réel, configurez le dépôt GitHub de données (voir le guide de mise en ligne).</span><span class="short"><strong>Mode local</strong> · données non partagées</span><button class="icon-btn" aria-label="Masquer" id="banner-x">${icon('close')}</button></div>`;
      el.querySelector('#banner-x').onclick = () => { sessionStorageSet('hideLocalBanner', '1'); el.innerHTML = ''; };
    } else if (backend.kind === 'github' && backend.repoInfo && backend.repoInfo.private === false) {
      el.innerHTML = `<div class="banner banner-danger">${icon('alertCircle')}<span class="long"><strong>Dépôt public :</strong> les données sont enregistrées dans <a href="https://github.com/${esc(backend.location.owner)}/${esc(backend.location.repo)}" target="_blank" rel="noopener noreferrer">${esc(backend.location.owner)}/${esc(backend.location.repo)}</a>, lisible par tout le monde sur Internet. Passez ce dépôt en privé (Settings › General › Danger Zone › Change visibility) ou utilisez un dépôt privé.</span><span class="short"><strong>Dépôt public</strong> · données visibles de tous</span></div>`;
    } else el.innerHTML = '';
  }

  /* ---------------------------------------------------------- Actions */

  async function newContract(values = {}) {
    const name = values.client ? values.client : await promptDialog({ title: 'Nouveau compte client', label: 'Nom du client', placeholder: 'ex. ALTO DISTRIBUTION', confirmLabel: 'Créer le compte' });
    if (name === null || name === undefined) return null;
    const client = String(name).trim();
    if (!client) { toast('Le nom du client est obligatoire.', { type: 'warning' }); return null; }
    const existing = store.state.list.find((c) => c.values.client && accountKey(c.values.client) === accountKey(client));
    if (existing && !values.division) { go(`#/compte/${encodeURIComponent(accountKey(client))}`); toast('Ce client existe déjà : ajoutez-lui une division.', { type: 'info' }); return null; }
    const id = await store.createContract({ ...values, client });
    toast(`Compte « ${client} » créé : choisissez sa division (cliquez sur « ? »).`, { type: 'success', action: { label: 'Annuler', fn: () => store.undo() } });
    go(`#/compte/${encodeURIComponent(accountKey(client))}`);
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
      { label: document.documentElement.dataset.theme === 'dark' ? 'Thème clair' : 'Thème sombre', icon: document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', onClick: () => $('#theme-btn').click() },
    ];
    if (backend.kind === 'github') {
      items.push({ label: 'Lien d’accès pour l’équipe…', icon: 'link', onClick: () => go('#/parametres/connexion') });
      items.push({ label: 'Actualiser maintenant', icon: 'refresh', onClick: () => { backend.refreshNow?.(); toast('Lecture du dépôt en cours…', { timeout: 1500 }); } });
      items.push({ divider: true });
      items.push({ label: 'Changer de clé / se déconnecter', icon: 'logout', onClick: async () => {
        const pending = backend.pendingCount?.() || 0;
        if (pending && !(await confirmDialog({ title: 'Modifications en attente', message: `${pending} modification(s) n’ont pas encore été envoyées à GitHub. Elles seront reprises à la prochaine connexion sur ce poste.`, confirmLabel: 'Se déconnecter quand même' }))) return;
        await backend.signOut(); location.reload();
      } });
    }
    if (!team.length) items.splice(1, 1);
    menu(e.currentTarget, items, { placement: 'bottom-end' });
  });

  function chooseIdentity() {
    const team = store.state.settings.team || [];
    const body = document.createElement('div');
    body.className = 'identity-list';
    body.innerHTML = `<p class="muted">Sélectionnez votre nom : le filtre « Mes comptes » et votre nom dans le journal s’appuient sur ce choix${backend.kind === 'github' ? ' (indispensable si l’équipe partage un même lien d’accès)' : ''}.</p>
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
    if (!alive()) return;
    current?.update?.('data', payload);
    updateDrawer(ctx, 'data', payload);
    if (pendingContract && (store.getContract(pendingContract) || store.state.loaded.contracts)) {
      const id = pendingContract;
      pendingContract = null;
      if (id !== currentContractId()) openContract(ctx, id, { fromRoute: true });
    }
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
      toast(`${who} a modifié ${list.length > 2 ? `${list.length} lignes` : list.join(' et ')}.`, { type: 'remote', timeout: 3500 });
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
  if (!readHash()) writeHash(`#/${parseHash().routeId}`, { replace: true });
  // Accès partagé (lien d'équipe) : chacun indique qui il est, pour le journal et « Mes comptes ».
  if (backend.kind === 'github' && !store.meMember() && (store.state.settings.team || []).length && !sessionStorageGet('askedIdentity')) {
    sessionStorageSet('askedIdentity', '1');
    setTimeout(chooseIdentity, 400);
  }
  ctx.accessLink = (token) => accessLink(`${location.origin}${location.pathname}`, token, backend.location);
  return ctx;
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* indisponible */ } }

export { confirmDialog };
