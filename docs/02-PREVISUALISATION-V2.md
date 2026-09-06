# Greffier v2 — prévisualisation (à valider avant code)

Version visuelle, avec l'open space animé : voir l'artefact publié depuis la session.

## Navigation

Dashboard · Scénarios · Open space · Paramètres, plus un compteur « À valider » sur le dashboard.
L'onglet Scénarios remplace l'onglet Robots.

## Onglet Scénarios

- Liste des scénarios (version, planification, dernier résultat).
- Dépôt : glisser un `.py` ou coller le code.
- Contrôles automatiques : syntaxe, contrat (KEY, NAME, run), clé disponible, actions déclarées,
  imports réseau à autoriser, aucun envoi sortant hors `ctx.propose`.
- Essai à blanc en bac à sable (dossier d'exemple, sans envoi, sorties dans `sorties/essais/`).
- Versions conservées, retour arrière en un clic.

## Open space et équipe de robots

- Trois robots = trois postes d'exécution (nombre réglable). Un scénario est un ticket qu'un robot libre prend.
- File d'attente affichée sur un tableau. Robot sans travail au coin pause.
- Le scénario déclare ses actions avec `ctx.step(type, libellé)` ; le robot va à la station correspondante.

## Catalogue d'actions (10)

| Action | Station / animation | Mesure |
|---|---|---|
| mail.lire | courrier, enveloppe | messages lus |
| mail.repondre | bureau, brouillon | brouillons |
| doc.lire | bureau, loupe | pages lues |
| doc.remplir | bureau, stylo, feuilles vers le bac | documents produits |
| web.consulter | terminal web | requêtes, délai |
| verifier | bureau, coche/croix | contrôles, écarts |
| propose | guichet « à valider », sonnette | propositions, délai de validation |
| envoyer | bannette de départ | envois |
| archiver | armoire | fichiers archivés |
| attendre | coin pause | temps d'attente |

Erreur dans une action : robot arrêté sur place, fumée, écran rouge ; l'exécution indique l'action fautive.

## Onglet Paramètres

Général · Équipe de robots (postes, noms, ordre de file, durée max, nouvelle tentative) · Emplacements ·
Notifications (e-mail / webhook Teams, résumé hebdo) · Conservation · Coffre à secrets · Accès réseau · Sauvegarde.

## Autres idées

v2 : file de validation, chronologie par exécution, arrêt d'un scénario, journal en direct, alerte sur échec.
Plus tard : modèles de scénarios, vue calendrier, résumé hebdomadaire PDF, démarrage avec Windows,
contrôle de santé des connecteurs, registre RGPD pré-rempli, accès lecture seule.

## Points à valider

A onglets · B robots = postes · C catalogue d'actions · D dépôt de code · E idées v2 · F style de l'open space ·
G ordre de livraison (onglets + Scénarios → actions + open space → validation → Paramètres → essai à blanc et le reste).
