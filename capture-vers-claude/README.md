# Capture d'écran → Claude, depuis le centre de contrôle

Objectif : un bouton dans le centre de contrôle de l'iPhone qui

1. prend une capture d'écran,
2. demande un texte à saisir,
3. envoie le tout dans une conversation Claude de l'application Claude (dans le cadre de l'abonnement, **sans clé API**).

## Pourquoi il n'y a rien à coder

Deux contraintes iOS rendent une app maison inutile (et même impossible) ici :

- **Aucune app tierce ne peut capturer l'écran en dehors d'elle-même.** La seule voie supportée par Apple est l'action « Prendre une capture d'écran » de l'app **Raccourcis**.
- **Aucune app tierce ne peut écrire dans les conversations de l'app Claude.** Seule l'intégration officielle d'Anthropic le permet — et elle existe : l'app Claude iOS expose une action Raccourcis **« Ask Claude » / « Demander à Claude »** qui envoie une requête sur votre abonnement, avec le modèle par défaut de l'app, et la conversation apparaît ensuite dans l'historique de l'app Claude.

La solution est donc un **raccourci Apple** (app Raccourcis) combinant les deux, placé dans le centre de contrôle (iOS 18+).

## Prérequis

- iOS 18 ou plus récent (pour placer un raccourci dans le centre de contrôle).
- L'app **Claude** installée et connectée à votre compte/abonnement.
- L'app **Raccourcis** (préinstallée).

## Recette A — tout dans Raccourcis (à privilégier)

Dans Raccourcis → « + » → nouveau raccourci, nommé par ex. **« Capture vers Claude »** :

1. **Prendre une capture d'écran** (action système).
2. **Demander une saisie** — type *Texte*, question : « Que veux-tu demander à Claude ? ».
3. **Demander à Claude** (action fournie par l'app Claude) :
   - dans le champ de la requête, insérez la variable **Saisie fournie** (le texte de l'étape 2) ;
   - joignez la variable **Capture d'écran** de l'étape 1. Selon la version de l'app Claude, l'action expose un champ de pièce jointe/image — vérifiez en touchant la flèche de l'action pour déplier ses paramètres.
4. La réponse s'affiche directement, et la conversation est visible dans l'app Claude.

> Si votre version de l'action « Demander à Claude » n'accepte que du texte (pas d'image), utilisez la recette B.

## Recette B — via la feuille de partage (fonctionne toujours)

1. **Prendre une capture d'écran**.
2. **Demander une saisie** (texte) → **Copier dans le presse-papiers** (facultatif).
3. **Partager** la capture → choisissez **Claude** dans la feuille de partage : l'app Claude s'ouvre avec l'image jointe, il ne reste qu'à coller/taper le texte et envoyer.

Un appui de plus que la recette A, mais garanti quelle que soit la version de l'app.

## Ajouter le bouton au centre de contrôle

1. Ouvrez le centre de contrôle → appui long → **Ajouter un contrôle**.
2. Cherchez **« Raccourci »** (contrôle fourni par l'app Raccourcis) et placez-le.
3. Touchez le contrôle → sélectionnez **« Capture vers Claude »**.

Le même raccourci peut aussi être assigné au **bouton Action** (iPhone 15 Pro et +) ou lancé par un double tap au dos (Réglages → Accessibilité → Toucher → Toucher le dos de l'appareil).

À noter : l'app Claude fournit aussi son propre contrôle **« Analyser une photo avec Claude »** pour le centre de contrôle — pratique, mais il ouvre l'appareil photo/la photothèque au lieu de prendre une capture d'écran, d'où l'intérêt du raccourci ci-dessus.

## Limites connues

- **« En fond »** : l'action « Demander à Claude » s'exécute sans ouvrir l'app Claude (la réponse s'affiche dans une bulle Raccourcis). En revanche, la saisie du texte affiche forcément une petite fenêtre — iOS ne permet pas de demander une saisie de manière invisible. La recette B, elle, ouvre l'app Claude.
- **La capture peut inclure le centre de contrôle ouvert.** Si c'est le cas sur votre version d'iOS, lancez plutôt le raccourci via le bouton Action ou le toucher du dos, qui ne recouvrent pas l'écran.
- **Consommation** : chaque requête compte dans les limites d'usage de l'abonnement, comme un message envoyé dans l'app.

## Alternative (non retenue) : l'API

Un vrai fonctionnement 100 % en arrière-plan (sans aucune interface) n'est possible qu'en passant par l'API Anthropic avec une clé API facturée à part — hors abonnement, et les conversations n'apparaissent pas dans l'app Claude. C'est l'approche à revisiter seulement si les limites ci-dessus deviennent bloquantes.
