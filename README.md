# Suivi Contract Management — saison contractuelle 2027

Outil de suivi de la saison contractuelle par **compte client**, qui remplace le classeur « Fichier de suivi
CM 2027 » : les mêmes informations, lisibles d'un coup d'œil et **modifiables en même temps** par toute
l'équipe. Le site est publié sur GitHub Pages ;
les données sont enregistrées dans un **dépôt GitHub privé** (un fichier par ligne, chaque modification est
un commit), lu toutes les 5 secondes par chaque poste.

![Accueil](docs/img/accueil.png)

## L'outil

- **Tableau de bord** très visuel : compte à rebours jusqu'au 1er mars, dossiers par phase, nombre de dossiers
  à chacune des 15 étapes REPORT PAR DIV, avancement par division, par CM et par juriste, dossiers qui
  n'avancent plus, activité récente de l'équipe, notes partagées.
- **Comptes clients** : une ligne par client, ses divisions et leur avancement en barres de progression,
  sans défilement horizontal ; recherche, filtres (phase, CM, juriste, division), tri.
- **Fiche du compte** : une carte par division avec son étape (un clic sur la barre suffit), l'équipe, les
  jalons, la note de suivi ; les informations du client saisies une fois pour toutes ses divisions ;
  échanges et activité de l'équipe.
- **Une seule saisie : l'étape REPORT PAR DIV**. REPORT GEN, qui n'en est que la synthèse, est déduit
  automatiquement (correspondance réglable), comme la date du dernier changement d'étape.
- **Reportings** du fichier : général (synthèse, tableau TOTAL SEF / CE / IM, graphique FR / EN), par
  division, suivi hebdomadaire et e-mail du vendredi (brouillon Outlook avec images).
- **Travail à plusieurs** en temps réel, fusion des modifications simultanées, hors connexion, journal.
- **Import** du classeur `.xlsm` (colonnes reconnues automatiquement) et **export** Excel mis en forme ;
  vue tableur facultative pour les saisies en masse.
- Charte Samsung, thèmes clair et sombre, ordinateur, tablette et téléphone.

## Démarrer

- **Mise en ligne** (dépôt de données privé, clé d'accès, GitHub Pages, import du fichier) :
  [docs/MISE-EN-LIGNE.md](docs/MISE-EN-LIGNE.md)
- **Guide des contract managers** : [docs/GUIDE-UTILISATEUR.md](docs/GUIDE-UTILISATEUR.md)
- **Aperçu sans installation** : `apercu-suivi-cm-2027.html` (un seul fichier, données fictives, à ouvrir
  dans le navigateur ; reconstruit par `npm run preview`).

> **Confidentialité** : les données (clients, signataires, conditions) vont **uniquement** dans le dépôt de
> données **privé**. Ce dépôt-ci ne contient que l'application et des données de démonstration fictives.

## Organisation

```
site/                       application publiée sur GitHub Pages (aucune étape de compilation)
  index.html, config.js     page et configuration (dépôt de données, saison)
  assets/css/app.css        charte graphique
  assets/js/core/           modèle du classeur, calculs, stockage GitHub et local, Excel, e-mail
  assets/js/ui/             composants (pastilles, calendrier, graphiques, fenêtres)
  assets/js/views/          écrans (tableau de bord, comptes, fiche compte, reportings, hebdo, journal…)
  vendor/exceljs.min.js     lecture / écriture Excel embarquée (aucun CDN externe)
docs/                       guides
tests/                      tests unitaires, parcours navigateur, deux utilisateurs sur un GitHub simulé
tools/                      aperçu autonome, dépendances embarquées
```

## Qualité

| Commande | Contenu |
|---|---|
| `npm run test:unit` | tests des calculs (étape DIV → REPORT GEN, durées, jours à la même étape, N-1, contrôle des jalons), comptes clients, reportings, suivi hebdo, import du format « Suivi CM », export puis réimport, stockage GitHub (initialisation, fusion, conflits, droits) |
| `npm run test:e2e` | parcours complets dans un vrai navigateur : tableau de bord, comptes, fiche compte (étape, jalons, champs client, divisions, commentaires), vue tableur, reportings, e-mail du vendredi (.eml), paramètres, import / export, sauvegarde, mobile |
| `npm run test:sync` | 16 étapes à deux personnes sur un serveur GitHub simulé : connexion par clé et par lien, propagation, modifications simultanées, références uniques, hors ligne, suppression concurrente, clé en lecture seule, dépôt public signalé, déconnexion |

Audit d'accessibilité (axe-core, WCAG A/AA) sans violation sur tous les écrans, en thème clair et sombre.
L'import a été vérifié sur le classeur réel (211 lignes, totaux identiques à l'onglet 4.Rep Gen TAB).
