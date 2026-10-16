// Écrans d'accès à la base partagée sur GitHub : connexion par clé d'accès, dépôt à créer, accès refusé.

import { icon } from '../ui/icons.js';
import { SAMSUNG_LOGO } from '../ui/logo.js';
import { esc } from '../core/utils.js';

/** Lien GitHub de création d'une clé d'accès « fine-grained » pré-remplie (dépôt de données, droits Contents). */
export function tokenCreationUrl(loc) {
  const p = new URLSearchParams({
    name: 'Suivi saison contractuelle',
    description: 'Accès de l’application de suivi au dépôt de données',
    target_name: loc.owner || '',
    expires_in: '366',
    contents: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${p}`;
}

export function repoCreationUrl(loc) {
  const p = new URLSearchParams({ name: loc.repo || 'suivi-cm-donnees', visibility: 'private', description: 'Données du suivi de la saison contractuelle (privé)' });
  if (loc.owner) p.set('owner', loc.owner);
  return `https://github.com/new?${p}`;
}

function shell(seasonName, panel) {
  return `
    <div class="login">
      <div class="login-art" aria-hidden="true">
        <div class="login-art-inner">
          <div class="login-art-logo">${SAMSUNG_LOGO}</div>
          <p class="login-art-kicker">Direction juridique · Contract Management</p>
          <h2 class="login-art-title">${esc(seasonName)}</h2>
          <p class="login-art-text">Le suivi des comptes clients, modifiable en même temps par toute l’équipe : reportings, suivi hebdomadaire et charge de l’équipe toujours à jour.</p>
          <ul class="login-art-list">
            <li>${icon('users')}Modifications simultanées, visibles par tous en quelques secondes</li>
            <li>${icon('history')}Données hébergées sur GitHub, chaque modification tracée</li>
            <li>${icon('sheet')}Import et export Excel</li>
          </ul>
        </div>
      </div>
      <main class="login-panel">${panel}</main>
    </div>`;
}

export function renderLogin(root, { backend, seasonName, error = '' }) {
  const loc = backend.location;
  root.innerHTML = shell(seasonName, `
    <form class="login-form" novalidate>
      <div class="login-logo">${SAMSUNG_LOGO}</div>
      <h1>Accès au suivi</h1>
      <p class="muted">Ouvrez le <strong>lien d’accès</strong> transmis par le responsable de l’outil, ou collez ci-dessous votre clé d’accès GitHub.</p>
      <label class="field"><span class="field-label">Clé d’accès GitHub</span>
        <span class="pw-wrap"><input class="input input-lg" type="password" name="token" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required autofocus><button type="button" class="icon-btn pw-toggle" aria-label="Afficher la clé">${icon('eye')}</button></span></label>
      <div class="login-error" role="alert" ${error ? '' : 'hidden'}>${esc(error)}</div>
      <button class="btn btn-primary btn-lg btn-block" type="submit"><span>Se connecter</span></button>
      <details class="login-help">
        <summary>Obtenir une clé d’accès personnelle</summary>
        <ol>
          <li>Connectez-vous à GitHub avec un compte ayant accès au dépôt <strong>${esc(`${loc.owner}/${loc.repo}`)}</strong>.</li>
          <li><a href="${esc(tokenCreationUrl(loc))}" target="_blank" rel="noopener noreferrer">Créez une clé « fine-grained »</a> : propriétaire <strong>${esc(loc.owner)}</strong>, accès au seul dépôt <strong>${esc(loc.repo)}</strong>, permission <strong>Contents : Read and write</strong>.</li>
          <li>Copiez la clé générée et collez-la ci-dessus. Elle reste enregistrée dans ce navigateur.</li>
        </ol>
      </details>
      <p class="login-note">${icon('lock')}<span>Données : <a href="https://github.com/${esc(`${loc.owner}/${loc.repo}`)}" target="_blank" rel="noopener noreferrer">github.com/${esc(`${loc.owner}/${loc.repo}`)}</a>. La clé n’est jamais envoyée ailleurs qu’à GitHub.</span></p>
    </form>`);
  const form = root.querySelector('form');
  const err = root.querySelector('.login-error');
  const showErr = (msg) => { err.hidden = false; err.textContent = msg; };
  root.querySelector('.pw-toggle').addEventListener('click', (e) => {
    const inp = form.token;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eyeOff');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (!form.token.value.trim()) { showErr('Collez votre clé d’accès, ou ouvrez le lien d’accès reçu.'); return; }
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Connexion…';
    try {
      await backend.signIn(form.token.value);
      location.reload();
    } catch (ex) {
      showErr(ex.code === 'unavailable' ? 'GitHub est injoignable depuis ce poste : vérifiez la connexion (ou le proxy de l’entreprise).' : ex.message);
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Se connecter';
    }
  });
}

/** Dépôt de données introuvable : instructions de création (dépôt privé) puis nouvel essai. */
export function renderSetup(root, { backend, seasonName, onSignOut }) {
  const loc = backend.location;
  root.innerHTML = shell(seasonName, `
    <div class="login-form">
      <div class="login-logo">${SAMSUNG_LOGO}</div>
      <h1>Dépôt de données à créer</h1>
      <p>Le dépôt <strong>${esc(`${loc.owner}/${loc.repo}`)}</strong> est introuvable avec votre clé d’accès.</p>
      <ol class="steps">
        <li><a href="${esc(repoCreationUrl(loc))}" target="_blank" rel="noopener noreferrer">Créez le dépôt <strong>privé</strong> ${esc(loc.repo)}</a> (compte ${esc(loc.owner)}), sans fichier initial.</li>
        <li>Vérifiez que votre clé d’accès inclut ce dépôt avec la permission <strong>Contents : Read and write</strong>.</li>
        <li>Revenez ici et cliquez sur « Réessayer » : l’application prépare elle-même les données.</li>
      </ol>
      <div class="btn-row"><button class="btn btn-primary" data-act="retry">${icon('refresh')}<span>Réessayer</span></button><button class="btn btn-ghost" data-act="out">${icon('logout')}<span>Changer de clé</span></button></div>
    </div>`);
  root.querySelector('[data-act="retry"]').addEventListener('click', () => location.reload());
  root.querySelector('[data-act="out"]').addEventListener('click', onSignOut);
}

export function renderDenied(root, { title = 'Accès non autorisé', message, onSignOut }) {
  root.innerHTML = `
    <div class="center-screen">
      <div class="card denied">
        <div class="empty-ico warn">${icon('lock')}</div>
        <h1>${esc(title)}</h1>
        <p>${esc(message || 'Votre clé d’accès ne permet pas de lire les données du suivi.')}</p>
        <p class="muted">Demandez au responsable de l’outil un lien d’accès, ou une clé donnant accès au dépôt de données.</p>
        <button class="btn btn-secondary" data-act="out">${icon('logout')}<span>Changer de clé</span></button>
      </div>
    </div>`;
  root.querySelector('[data-act="out"]').addEventListener('click', onSignOut);
}

export function renderFatal(root, { title, message }) {
  root.innerHTML = `<div class="center-screen"><div class="card denied"><div class="empty-ico warn">${icon('alertCircle')}</div><h1>${esc(title)}</h1><p>${esc(message)}</p><button class="btn btn-secondary" onclick="location.reload()">${icon('refresh')}<span>Recharger la page</span></button></div></div>`;
}
