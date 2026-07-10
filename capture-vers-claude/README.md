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

## Limitation vérifiée (juillet 2026)

L'action **« Demander à Claude »** de l'app Claude n'accepte **que du texte** : son seul
paramètre est *Message*, sans champ de pièce jointe. Impossible donc de lui passer la
capture d'écran directement. Le montage qui fonctionne passe par la **feuille de
partage** de Claude (qui, elle, accepte les images), avec le texte préparé dans le
presse-papiers.

## Recette — capture + texte via la feuille de partage

Dans Raccourcis → « + » → nouveau raccourci, nommé par ex. **« Capture vers Claude »** :

1. **Prendre une capture d'écran** (action système).
2. **Demander une saisie** — type *Texte*, invite : « Que veux-tu demander à Claude ? ».
3. **Copier dans le presse-papiers** — ⚠️ avec la variable **Saisie fournie** (le
   *texte* de l'étape 2, pas la capture : c'est l'image qui sera transmise par le
   partage, le texte qui sera collé).
4. **Partager** — avec la variable **Capture d'écran** de l'étape 1.

À l'exécution : la feuille de partage s'ouvre → touchez **Claude** → l'app s'ouvre avec
l'image jointe → appui long dans le champ de message → **Coller** → envoyer.
Deux appuis manuels (Claude, Coller) : c'est le minimum possible sans API.

### Variante à tester : partager image + texte d'un coup

Certaines extensions de partage acceptent plusieurs éléments à la fois. À essayer :
étape 4, partager une **liste** contenant à la fois *Capture d'écran* et *Saisie
fournie* (action « Liste » ou en réglant l'entrée du Partager). Si l'extension Claude
le supporte, le texte arrive prérempli et il ne reste qu'à envoyer. Sinon, revenez à
la recette ci-dessus.

### Pour les questions sans image

L'action « Demander à Claude » reste parfaite en texte seul : *Demander une saisie* →
*Demander à Claude* avec la variable en Message — réponse affichée sans ouvrir l'app.

## Ajouter le bouton au centre de contrôle

1. Ouvrez le centre de contrôle → appui long → **Ajouter un contrôle**.
2. Cherchez **« Raccourci »** (contrôle fourni par l'app Raccourcis) et placez-le.
3. Touchez le contrôle → sélectionnez **« Capture vers Claude »**.

Le même raccourci peut aussi être assigné au **bouton Action** (iPhone 15 Pro et +) ou lancé par un double tap au dos (Réglages → Accessibilité → Toucher → Toucher le dos de l'appareil).

À noter : l'app Claude fournit aussi son propre contrôle **« Analyser une photo avec Claude »** pour le centre de contrôle — pratique, mais il ouvre l'appareil photo/la photothèque au lieu de prendre une capture d'écran, d'où l'intérêt du raccourci ci-dessus.

## Limites connues

- **« En fond »** : dès qu'une image est impliquée, l'app Claude s'ouvre (via la feuille de partage) — l'action « Demander à Claude », seule capable de s'exécuter sans ouvrir l'app, ne prend pas d'image. Et la saisie du texte affiche forcément une petite fenêtre : iOS ne permet pas de demander une saisie de manière invisible.
- **La capture peut inclure le centre de contrôle ouvert.** Si c'est le cas sur votre version d'iOS, lancez plutôt le raccourci via le bouton Action ou le toucher du dos, qui ne recouvrent pas l'écran.
- **Consommation** : chaque requête compte dans les limites d'usage de l'abonnement, comme un message envoyé dans l'app.

## Alternative (non retenue) : l'API

Un vrai fonctionnement 100 % en arrière-plan (sans aucune interface) n'est possible qu'en passant par l'API Anthropic avec une clé API facturée à part — hors abonnement, et les conversations n'apparaissent pas dans l'app Claude. C'est l'approche à revisiter seulement si les limites ci-dessus deviennent bloquantes.
