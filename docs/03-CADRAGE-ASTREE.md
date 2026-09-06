# Astrée — cadrage v3 (à valider avant code)

Version visuelle avec l'open space animé : artefact publié depuis la session.

## Contexte

- Samsung France, direction juridique puis fonctions support.
- Plate-forme RPA locale : sur le PC de l'auteur d'abord, sur les serveurs locaux ensuite.
- Exécution headless : les scénarios tournent en arrière-plan, sans fenêtre, pendant que l'utilisateur travaille.
- Visualisation temps réel de l'activité des robots dans un open space 2D : robots disponibles, robots occupés, action en cours.
- Deux ou trois scénarios pour commencer, reliés aux systèmes internes : SELMS+ (CLM), Outlook, DocuSign.
- Un robot prend un scénario et le mène jusqu'au bout.
- Tableau de bord de performance ; dépôt de scénarios sous forme de scripts Python.
- La plate-forme et chaque robot portent un nom.

## Nom et équipe (propositions)

- Plate-forme : **Astrée** (recommandé) · Portalis · Relève.
- Robots : **Vega, Altaïr, Deneb** (recommandé) · Cujas, Domat, Pothier.
- Le nom de la plate-forme se change en un endroit du code ; les noms des robots sont un réglage dans Paramètres.

## Identité visuelle

Inspirée de la charte : bleu profond #1428A0 pour l'accent, fonds blancs et gris froids, coins arrondis, typographie
géométrique. États sémantiques : réussi #1E8E5A, réserves #B8730F, échec #C62828. Aucun logo ni marque reproduits.

## Open space

- Robots dessinés en juristes (costume, chemise, cravate à la couleur du robot, antenne qui clignote au travail).
- Stations nommées d'après les systèmes : SELMS+, Outlook, DocuSign, Partage, plus les bureaux et le coin pause.
- Un robot = un poste d'exécution (3 postes = 3 scénarios en parallèle au maximum). Un scénario est un ticket pris par
  le premier robot libre. Le tableau du haut affiche la file d'attente et les robots libres.
- `ctx.step(type, libellé)` déclare l'action en cours et déplace le robot. Échec : robot arrêté, écran rouge, fumée,
  action fautive nommée dans l'exécution.

## Scénario 1 — extraction mensuelle des contrats signés dans SELMS+

1. `web.consulter` — ouvrir SELMS+ (navigateur invisible), session enregistrée
2. `web.consulter` — filtrer les contrats signés du 1er au dernier jour du mois
3. `web.consulter` — exporter, renommer `AAAA-MM_contrats_signes.xlsx`
4. `verifier` — lignes, colonnes attendues, doublons, dates hors période
5. `archiver` — dépôt dans le dossier partagé du mois, mise à jour du registre
6. `propose` — e-mail de synthèse soumis à validation
7. `envoyer` — après approbation (ou automatique si décidé pour ce scénario)

Déclenchement : le 29 saute février trois années sur quatre. Recommandation : dernier jour ouvré du mois à 7h
(ou le 28 à 7h), plus « Lancer maintenant » depuis la plate-forme.

## Connecteurs

- **SELMS+** : probablement sans API → pilotage de l'interface web par Playwright (Chromium headless) à partir de la
  cartographie des écrans. À confirmer : authentification (SSO, MFA), durée de vie de session.
- **Outlook** : Outlook local (COM) d'abord ; Microsoft Graph pour le serveur (inscription d'application auprès de l'IT).
- **DocuSign** : API REST (clé d'intégration), pour les scénarios 2–3.
- Secrets et sessions dans le gestionnaire d'identifiants Windows, jamais dans les fichiers. Session expirée →
  arrêt propre, robot bloqué visible à la station SELMS+, alerte.

## Plan de livraison

1. Identité et onglets : renommage, thème, Dashboard · Scénarios · Open space · Paramètres, dépôt de code,
   contrôles, versions, équipe nommée.
2. Open space v2 : juristes-robots, stations par système, catalogue d'actions, file d'attente, postes d'exécution.
3. SELMS+ et scénario 1 : connecteur, coffre, scénario écrit à partir de la cartographie, planification.
4. Outlook, file de validation, envoi de la synthèse, puis DocuSign.

## Points à valider

A nom · B noms des robots · C jour de déclenchement · D accès SELMS+ (UI ou API, authentification) ·
E validation ou envoi automatique de la synthèse · F identité visuelle · G personnages juristes-robots · H ordre.
