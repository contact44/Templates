// Point d'entrée : lit la configuration, choisit le stockage (Firebase ou local),
// gère la connexion puis démarre l'application.

import { createLocalBackend } from './core/backend-local.js';
import { createStore } from './core/store.js';
import { defaultSettings } from './core/schema.js';
import { buildDemo } from './core/demo.js';
import { safeStorage, setToday } from './core/utils.js';
import { installTooltips } from './ui/overlay.js';
import { startApp, authError } from './app.js';
import { renderDenied, renderFatal, renderLogin } from './views/login.js';

const config = { seasonId: '2027', firebase: null, ...(globalThis.APP_CONFIG || {}) };
const root = document.getElementById('app');

function applyTheme() {
  const prefs = safeStorage.get('saison:prefs', {}) || {};
  const theme = prefs.theme || (globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}

function firebaseConfigured() {
  const f = config.firebase;
  return !!(f && f.apiKey && f.projectId && !String(f.apiKey).includes('VOTRE'));
}

async function boot() {
  applyTheme();
  installTooltips();
  const params = new URLSearchParams(location.search);
  const isLocalhost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (config.fixedToday) setToday(config.fixedToday);
  if (isLocalhost && /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '')) setToday(params.get('today'));
  const useEmulator = params.has('emulator') && isLocalhost;
  if (useEmulator) {
    config.firebase = config.firebase || { apiKey: 'demo-key', authDomain: 'localhost', projectId: params.get('project') || 'demo-saison', appId: 'demo' };
    config.emulator = true;
    config.firebase.projectId = params.get('project') || config.firebase.projectId;
  }

  let backend;
  if (firebaseConfigured() || useEmulator) {
    try {
      const { createFirebaseBackend } = await import(['.', 'core', 'backend-firebase.js'].join('/'));
      backend = await createFirebaseBackend(config);
    } catch (err) {
      console.error(err);
      renderFatal(root, { title: 'Connexion à la base impossible', message: `Le module Firebase n’a pas pu être chargé (${err.message}). Vérifiez la configuration dans config.js et votre accès réseau.` });
      return;
    }
  } else {
    backend = createLocalBackend({ seasonId: config.seasonId });
  }
  await backend.init();

  let started = false;
  backend.onAuth(async (user) => {
    if (!user) {
      if (started) { location.reload(); return; }
      document.body.classList.add('is-login');
      renderLogin(root, { backend, seasonName: defaultSettings().season.name, onAuthError: authError });
      return;
    }
    if (started) return;
    started = true;
    document.body.classList.remove('is-login');
    root.innerHTML = '<div class="boot"><div class="boot-spinner" aria-label="Chargement"></div></div>';
    const store = createStore(backend, { seasonId: config.seasonId });
    store.setUser(user);
    try {
      await backend.ensureSeason(defaultSettings());
    } catch (err) {
      if (String(err?.code || '').includes('permission-denied')) {
        renderDenied(root, { email: user.email, onSignOut: async () => { await backend.signOut(); location.reload(); } });
        return;
      }
    }
    let denied = false;
    const origStart = backend.start.bind(backend);
    backend.start = (h) => origStart({ ...h, denied: () => { if (!denied) { denied = true; renderDenied(root, { email: user.email, onSignOut: async () => { await backend.signOut(); location.reload(); } }); } } });
    await store.start();
    if (denied) return;
    // Aperçu : charge les données fictives au premier lancement.
    if (config.preview && backend.kind === 'local' && !store.state.list.length && !safeStorage.get('saison:previewSeeded')) {
      await store.loadDemo(buildDemo);
      safeStorage.set('saison:previewSeeded', true);
    }
    const ctx = startApp(root, store, { config });
    globalThis.__app = ctx;
  });
}

boot().catch((err) => {
  console.error(err);
  renderFatal(root, { title: 'Erreur au démarrage', message: err.message || String(err) });
});
