// Écran de connexion (mode Firebase) et écran « accès refusé ».

import { icon } from '../ui/icons.js';
import { SAMSUNG_LOGO } from '../ui/logo.js';
import { esc } from '../core/utils.js';

export function renderLogin(root, { backend, seasonName, onAuthError }) {
  root.innerHTML = `
    <div class="login">
      <div class="login-art" aria-hidden="true">
        <div class="login-art-inner">
          <div class="login-art-logo">${SAMSUNG_LOGO}</div>
          <p class="login-art-kicker">Direction juridique</p>
          <h2 class="login-art-title">${esc(seasonName)}</h2>
          <p class="login-art-text">Suivi partagé des négociations annuelles : CGV, conventions, échéances et signatures, en temps réel pour toute l’équipe.</p>
          <ul class="login-art-list">
            <li>${icon('users')}Modification simultanée à plusieurs</li>
            <li>${icon('bell')}Alertes sur les échéances légales</li>
            <li>${icon('sheet')}Import et export Excel</li>
          </ul>
        </div>
      </div>
      <main class="login-panel">
        <form class="login-form" novalidate>
          <div class="login-logo">${SAMSUNG_LOGO}</div>
          <h1>Connexion</h1>
          <p class="muted">Accès réservé à l’équipe juridique. Utilisez l’identifiant fourni par l’administrateur de l’outil.</p>
          <label class="field"><span class="field-label">Adresse e-mail</span><input class="input input-lg" type="email" name="email" autocomplete="username" required autofocus></label>
          <label class="field"><span class="field-label">Mot de passe</span>
            <span class="pw-wrap"><input class="input input-lg" type="password" name="password" autocomplete="current-password" required><button type="button" class="icon-btn pw-toggle" aria-label="Afficher le mot de passe">${icon('eye')}</button></span></label>
          <div class="login-error" role="alert" hidden></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit"><span>Se connecter</span></button>
          <button class="link-btn" type="button" data-act="reset">Mot de passe oublié ?</button>
          <p class="login-note">${icon('lock')}<span>Ces identifiants sont propres à cet outil : n’utilisez pas votre mot de passe Samsung.</span></p>
        </form>
      </main>
    </div>`;
  const form = root.querySelector('form');
  const err = root.querySelector('.login-error');
  const showErr = (msg, ok = false) => { err.hidden = false; err.textContent = msg; err.classList.toggle('ok', ok); };
  root.querySelector('.pw-toggle').addEventListener('click', (e) => {
    const inp = form.password;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eyeOff');
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (!form.email.value.trim() || !form.password.value) { showErr('Saisissez votre adresse e-mail et votre mot de passe.'); return; }
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Connexion…';
    try {
      await backend.signIn(form.email.value, form.password.value);
    } catch (ex) {
      showErr(onAuthError(ex));
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Se connecter';
    }
  });
  root.querySelector('[data-act="reset"]').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { showErr('Saisissez d’abord votre adresse e-mail, puis cliquez de nouveau sur « Mot de passe oublié ? ».'); form.email.focus(); return; }
    try { await backend.resetPassword(email); showErr(`Si un compte existe pour ${email}, un e-mail de réinitialisation vient d’être envoyé.`, true); } catch (ex) { showErr(onAuthError(ex)); }
  });
}

export function renderDenied(root, { email, onSignOut }) {
  root.innerHTML = `
    <div class="center-screen">
      <div class="card denied">
        <div class="empty-ico warn">${icon('lock')}</div>
        <h1>Accès non autorisé</h1>
        <p>Le compte <strong>${esc(email || '')}</strong> est bien connecté, mais il ne figure pas dans la liste des utilisateurs autorisés à consulter le suivi.</p>
        <p class="muted">Demandez à l’administrateur d’ajouter votre adresse dans les règles de sécurité Firestore (fichier <code>firebase/firestore.rules</code>).</p>
        <button class="btn btn-secondary" data-act="out">${icon('logout')}<span>Se déconnecter</span></button>
      </div>
    </div>`;
  root.querySelector('[data-act="out"]').addEventListener('click', onSignOut);
}

export function renderFatal(root, { title, message }) {
  root.innerHTML = `<div class="center-screen"><div class="card denied"><div class="empty-ico warn">${icon('alertCircle')}</div><h1>${esc(title)}</h1><p>${esc(message)}</p><button class="btn btn-secondary" onclick="location.reload()">${icon('refresh')}<span>Recharger la page</span></button></div></div>`;
}
