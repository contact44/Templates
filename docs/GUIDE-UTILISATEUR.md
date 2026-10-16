# Guide utilisateur

Ce guide s'adresse aux contract managers qui suivent la saison contractuelle au quotidien.

## Les vues

| Vue | À quoi elle sert |
|---|---|
| **Tableau de bord** | Compte à rebours jusqu'au 1er mars, jauges (CGV envoyées, conventions signées, CA signé), frise des jalons, indicateurs, pipeline par statut, avancement par contract manager / division / canal, rythme de signature, alertes prioritaires, échéances à 14 jours, activité récente. Un clic sur un indicateur ouvre la liste correspondante. |
| **Suivi des contrats** | Le tableau de suivi, comme dans Excel : on modifie directement dans les cellules, à plusieurs en même temps. |
| **Pipeline** | Les contrats rangés par statut ; on fait glisser une carte d'une colonne à l'autre pour changer son statut. |
| **Échéancier** | Les prochaines actions (en retard, cette semaine, semaine prochaine, plus tard) et le calendrier des négociations, de l'envoi des CGV à la signature. |
| **Journal** | Qui a modifié quoi, quand, avec l'ancienne et la nouvelle valeur. Filtrable et exportable. |
| **Paramètres** | Saison et jalons, équipe, listes de valeurs, colonnes, automatisations, modèles de relance, import / export / sauvegarde. |

La barre de filtres (recherche, contract manager, statut, division, canal, priorité) s'applique à toutes les
vues. Les raccourcis « Mes contrats », « Alertes », « En retard », « CGV à envoyer », « Bloqués », « Signés »
filtrent en un clic.

## Le tableau de suivi

- **Modifier une cellule** : double-clic, touche Entrée ou F2, ou commencez simplement à taper.
  Entrée valide et descend, Tab valide et passe à droite, Échap annule.
- **Listes** (statut, canal, priorité…) : la liste s'ouvre avec une recherche ; tapez quelques lettres puis Entrée.
- **Dates** : un calendrier en français s'ouvre. On peut aussi taper `01/12`, `1/12/2026`, `+7` (dans 7 jours),
  `demain`…
- **Sélection de plusieurs cellules** : Maj+clic ou cliquer-glisser. La somme et la moyenne des nombres
  sélectionnés s'affichent en bas du tableau.
- **Copier-coller avec Excel** : Ctrl+C / Ctrl+V fonctionnent dans les deux sens. Une valeur collée sur une
  plage remplit toute la plage. Des lignes collées sous le tableau peuvent être créées comme nouveaux contrats.
- **Effacer** : touche Suppr sur une cellule ou une plage.
- **Annuler / rétablir** : Ctrl+Z / Ctrl+Y (ou les flèches en haut de l'écran).
- **Trier** : clic sur un titre de colonne (Maj+clic pour un tri secondaire).
- **Filtrer une colonne** comme dans Excel : icône d'entonnoir dans le titre de la colonne.
- **Regrouper** par statut, contract manager, canal, division, priorité ou type.
- **Colonnes** : chacun peut masquer des colonnes pour lui-même ; la largeur se règle en tirant le bord du titre.
- **Actions groupées** : cochez des lignes, puis changez leur statut, contract manager, priorité, canal ou
  échéance en une fois, exportez-les ou supprimez-les.
- **Fiche complète** : icône d'ouverture à droite du nom du client, ou Ctrl+Entrée.

## La fiche contrat

- En-tête : statut, contract manager, priorité et avancement modifiables d'un clic ; les **étapes** du
  statut se franchissent en cliquant dessus.
- **Fiche** : tous les champs, regroupés par rubrique.
- **Commentaires** : fil de discussion visible par toute l'équipe.
- **Historique** : toutes les modifications de ce contrat.
- **Relance** : choisissez un modèle d'e-mail (retour sur les CGV, envoi d'une version, relance signature,
  point avec le KAM) ; le message s'ouvre pré-rempli dans votre messagerie, et l'outil peut programmer
  automatiquement la prochaine relance.
- Flèches ⌃ ⌄ : contrat précédent / suivant ; menu ⋯ : copier le lien vers la fiche, dupliquer, supprimer.

## Travailler à plusieurs

- Les modifications des collègues apparaissent en une à deux secondes, sans recharger la page ; la cellule
  modifiée clignote brièvement avec le prénom de son auteur.
- Les avatars en haut à droite indiquent qui est en ligne. Dans le tableau, la cellule ou la fiche sur
  laquelle travaille un collègue est entourée de sa couleur.
- Chaque modification ne touche que le champ concerné : deux personnes peuvent modifier des champs différents
  du même contrat sans rien perdre. Si deux personnes modifient le **même** champ, la dernière modification
  l'emporte et les deux restent tracées dans le journal.
- Hors connexion, on peut continuer à travailler : les modifications sont envoyées automatiquement au retour
  du réseau (indicateur en haut à droite).

## Les alertes

| Niveau | Exemples |
|---|---|
| Critique | CGV non envoyées après la date limite (art. L441-3 IV C. com.), contrat non signé après la date butoir (art. L441-3 III), négociation bloquée |
| Important | Action en retard, objectif interne dépassé, avancement insuffisant à l'approche de la date butoir |
| À surveiller | CGV à envoyer prochainement, action à échéance proche, signature attendue prochainement |
| Information | Contrat sans contract manager ou sans prochaine action |

Les seuils (nombre de jours) se règlent dans Paramètres › Saison et échéances.

## Automatisations

- Passer un contrat à « CGV envoyées » renseigne la date d'envoi des CGV (si elle est vide) ; passer à
  « Signé » renseigne la date de signature.
- Inversement, saisir la date de signature fait passer le contrat à « Signé ».
- Ces liens se configurent dans Paramètres › Listes de valeurs › Statuts (colonne « Date automatique ») et
  s'activent dans Paramètres › Automatisations. Les modifications automatiques portent la mention « auto »
  dans le journal.

## Excel

- **Exporter** : bouton Exporter du suivi. Le classeur contient le suivi (filtres, volets figés, listes
  déroulantes, échéances en retard en rouge), un tableau de bord, le journal et les listes de valeurs.
- **Importer** : fichier .xlsx / .xlsm / .csv, ou collage depuis Excel. Mode « Ajouter », « Mettre à jour »
  (contrats reconnus par leur référence ou le nom du client) ou « Remplacer ».
- **Imprimer / PDF** : menu Exporter › Imprimer ou enregistrer en PDF.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `/` | Aller à la recherche |
| Ctrl+Z / Ctrl+Y | Annuler / rétablir |
| Flèches, Tab | Se déplacer dans le tableau |
| Entrée, F2 | Modifier la cellule |
| Ctrl+Entrée | Ouvrir la fiche du contrat |
| Maj+flèches | Étendre la sélection |
| Ctrl+A | Tout sélectionner |
| Ctrl+C / Ctrl+X / Ctrl+V | Copier / couper / coller (compatible Excel) |
| Suppr | Effacer les cellules sélectionnées |
| Échap | Fermer la fiche, annuler la saisie |
