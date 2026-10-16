/*
 * Configuration de l'application « Suivi Contract Management — saison contractuelle ».
 *
 * Les données sont enregistrées dans un dépôt GitHub (fichiers JSON) et modifiées en temps réel
 * par toute personne disposant d'un accès (clé GitHub personnelle ou lien d'accès d'équipe).
 * Voir docs/MISE-EN-LIGNE.md.
 *
 * IMPORTANT — confidentialité : utilisez un dépôt PRIVÉ pour les données. Le dépôt qui publie le site
 * (GitHub Pages gratuit) est public : y enregistrer les données les rendrait lisibles par tout le monde.
 *
 * Pour travailler sans GitHub (données dans ce navigateur uniquement) : remplacez `github: { … }` par `github: null`.
 */
window.APP_CONFIG = {
  github: {
    owner: 'contact44',          // compte ou organisation GitHub propriétaire du dépôt de données
    repo: 'suivi-cm-donnees',    // dépôt PRIVÉ qui contient les données (créé une fois, vide)
    branch: '',                  // vide = branche par défaut du dépôt
    root: 'suivi-cm',            // dossier des données dans le dépôt
    pollMs: 5000,                // fréquence de lecture des modifications des autres (millisecondes)
  },

  // Identifiant de la saison : changez-le (ex. "2028") pour démarrer une nouvelle saison
  // sans effacer la précédente.
  seasonId: '2027',
};
