/*
 * Configuration de l'application « Suivi de la saison contractuelle ».
 *
 * MODE LOCAL (par défaut) : laissez `firebase: null`. Les données sont alors enregistrées
 * uniquement dans le navigateur de chaque utilisateur : rien n'est partagé.
 *
 * MODE PARTAGÉ EN TEMPS RÉEL : remplacez `null` par la configuration Web de votre projet
 * Firebase (console Firebase › Paramètres du projet › Vos applications › Config), par exemple :
 *
 *   firebase: {
 *     apiKey: "AIzaSy...",
 *     authDomain: "saison-contractuelle.firebaseapp.com",
 *     projectId: "saison-contractuelle",
 *     storageBucket: "saison-contractuelle.firebasestorage.app",
 *     messagingSenderId: "123456789012",
 *     appId: "1:123456789012:web:abcdef123456"
 *   },
 *
 * Ces valeurs ne sont pas secrètes : la protection des données repose sur la connexion
 * et sur les règles de sécurité Firestore (firebase/firestore.rules). Voir docs/MISE-EN-LIGNE.md.
 */
window.APP_CONFIG = {
  firebase: null,

  // Identifiant de la saison : changez-le (ex. "2028") pour démarrer une nouvelle saison
  // sans effacer la précédente.
  seasonId: '2027',
};
