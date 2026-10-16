// Point d'entrée : lit la configuration, choisit le stockage (dépôt GitHub partagé ou mode local),
// gère l'accès (clé ou lien d'accès) puis démarre l'application.

import { createLocalBackend } from './core/backend-local.js';
import { adoptAccessLink, createGithubBackend, githubLocation } from './core/backend-github.js';
import { createStore } from './core/store.js';
import { defaultSettings } from './core/schema.js';
import { buildDemo } from './core/demo.js';
import { safeStorage, setToday } from './core/utils.js';
import { installTooltips } from './ui/overlay.js';
import { startApp } from './app.js';
import { renderDenied, renderFatal, renderLogin, renderSetup } from './views/login.js';

const config = { seasonId: '2027', github: null, ...(globalThis.APP_CONFIG || {}) };
const root = document.getElementById('app');

function applyTheme() {
  const prefs = safeStorage.get('saison:prefs:v2', {}) || {};
  const theme = prefs.theme || (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}

async function boot() {
  applyTheme();
  installTooltips();
  const params = new URLSearchParams(location.search);
  const isLocalhost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (config.fixedToday) setToday(config.fixedToday);
  if (isLocalhost && /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '')) setToday(params.get('today'));
  // Tests automatisés : mode local forcé, ou API GitHub simulée sur ce poste.
  if (isLocalhost && params.has('local')) config.github = null;
  if (isLocalhost && params.get('gh')) {
    const [owner, repo] = (params.get('depot') || 'equipe/donnees').split('/');
    config.github = { ...(config.github || {}), apiBase: params.get('gh'), owner, repo, pollMs: Number(params.get('poll')) || 700 };
  }
  // Lien d'accès « #acces=… » : la clé est enregistrée dans ce navigateur puis retirée de l'adresse.
  if (adoptAccessLink(location.hash)) history.replaceState(null, '', `${location.pathname}${location.search}`);

  const seasonName = defaultSettings().season.name;
  const loc = githubLocation(config);
  const useGithub = !config.preview && !!(loc.owner && loc.repo);
  const backend = useGithub ? createGithubBackend(config) : createLocalBackend({ seasonId: config.seasonId });
  await backend.init();
  const signOut = async () => { await backend.signOut(); location.reload(); };

  let started = false;
  backend.onAuth(async (user, err) => {
    if (!user) {
      document.body.classList.add('is-login');
      if (err && err.code !== 'unauthenticated' && err.code === 'unavailable') {
        renderFatal(root, { title: 'GitHub injoignable', message: 'La connexion à GitHub est impossible depuis ce poste. Vérifiez votre accès à Internet (ou au proxy de l’entreprise), puis rechargez la page.' });
        return;
      }
      renderLogin(root, { backend, seasonName, error: err?.message || '' });
      return;
    }
    if (started) return;
    started = true;
    document.body.classList.remove('is-login');
    root.innerHTML = '<div class="boot"><div class="boot-spinner" aria-label="Chargement"></div><p class="boot-text">Chargement des données…</p></div>';
    const store = createStore(backend, { seasonId: config.seasonId });
    store.setUser(user);
    try {
      await backend.ensureSeason(defaultSettings());
    } catch (e) {
      console.error(e);
      if (e.code === 'not-found') { renderSetup(root, { backend, seasonName, onSignOut: signOut }); return; }
      if (e.code === 'permission-denied') { renderDenied(root, { message: 'Votre clé d’accès ne permet pas d’écrire dans le dépôt de données (permission « Contents : Read and write » nécessaire).', onSignOut: signOut }); return; }
      if (e.code === 'unauthenticated') { await signOut(); return; }
      if (e.code === 'unavailable') { renderFatal(root, { title: 'GitHub injoignable', message: 'Les données n’ont pas pu être chargées. Vérifiez la connexion puis rechargez la page.' }); return; }
      renderFatal(root, { title: 'Chargement impossible', message: e.message || String(e) });
      return;
    }
    let denied = false;
    const origStart = backend.start.bind(backend);
    backend.start = (h) => origStart({
      ...h,
      denied: () => { if (!denied) { denied = true; renderDenied(root, { onSignOut: signOut }); } },
      authLost: () => { if (!denied) { denied = true; renderLogin(root, { backend, seasonName, error: 'La clé d’accès a expiré ou a été révoquée : saisissez une nouvelle clé (vos modifications non envoyées sont conservées sur ce poste).' }); } },
    });
    await store.start();
    if (denied) return;
    // Aperçu : charge les données fictives au premier lancement.
    if (config.preview && !config.previewData && backend.kind === 'local' && !store.state.list.length && !safeStorage.get('saison:previewSeeded:v2')) {
      await store.loadDemo(buildDemo);
      safeStorage.set('saison:previewSeeded:v2', true);
    }
    if (config.previewData && backend.kind === 'local' && !store.state.list.length && !safeStorage.get(`saison:previewData:${config.seasonId}`)) {
      await store.restoreBackup(config.previewData);
      safeStorage.set(`saison:previewData:${config.seasonId}`, true);
    }
    const ctx = startApp(root, store, { config });
    globalThis.__app = ctx;
  });
}

boot().catch((err) => {
  console.error(err);
  renderFatal(root, { title: 'Erreur au démarrage', message: err.message || String(err) });
});
