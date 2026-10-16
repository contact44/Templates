# Mise en ligne

Ce guide met l'outil en ligne pour l'équipe Contract Management, en **une trentaine de minutes**, sans
installer de logiciel. Il suffit d'un compte GitHub (celui qui administrera l'outil).

## Principe

L'outil utilise **deux dépôts GitHub** :

| Dépôt | Contenu | Visibilité |
|---|---|---|
| **Site** (ex. `suivi-cm`) | l'application (pages, styles, scripts) publiée par GitHub Pages | public (aucune donnée dedans) |
| **Données** (`suivi-cm-donnees`) | un fichier JSON par ligne du suivi, les paramètres, les commentaires | **PRIVÉ** |

Chaque modification faite dans l'outil est enregistrée immédiatement dans le dépôt de données (un
« commit » GitHub). Les autres postes lisent ce dépôt toutes les 5 secondes : les modifications de chacun
apparaissent chez les autres sans recharger la page. Si deux personnes modifient la même ligne en même
temps, les deux saisies sont fusionnées champ par champ. Hors connexion, les modifications sont gardées sur
le poste et envoyées au retour du réseau.

> **Confidentialité.** Le dépôt de données doit rester **privé** : il contient les noms des clients, les
> signataires et les conditions commerciales. Un dépôt GitHub Pages gratuit est public : n'y placez jamais de
> données. L'outil affiche un bandeau rouge s'il détecte que le dépôt de données est public.

## 1. Créer le dépôt de données (privé)

1. Connectez-vous sur **github.com** puis ouvrez **https://github.com/new**.
2. *Owner* : votre compte (ex. `contact44`) ; *Repository name* : `suivi-cm-donnees`.
3. Cochez **Private**. Ne cochez rien d'autre (pas de README) : l'outil prépare le dépôt lui-même.
4. Cliquez sur **Create repository**.

## 2. Créer la clé d'accès

L'outil écrit dans le dépôt de données avec une **clé d'accès GitHub** (« fine-grained personal access
token ») limitée à ce seul dépôt.

1. Ouvrez **https://github.com/settings/personal-access-tokens/new**.
2. *Token name* : `Suivi CM` ; *Expiration* : la durée la plus longue proposée (notez la date de
   renouvellement dans votre agenda).
3. *Resource owner* : votre compte ; *Repository access* : **Only select repositories** › `suivi-cm-donnees`.
4. *Permissions* › *Repository permissions* › **Contents : Read and write** (les « Metadata : Read-only »
   s'ajoutent automatiquement). Aucune autre permission n'est nécessaire.
5. **Generate token**, puis copiez la clé (`github_pat_…`) : elle ne s'affiche qu'une fois.

**Pour l'équipe**, deux possibilités :

- **Simple (recommandée pour 2 ou 3 personnes)** : une seule clé, partagée par un **lien d'accès** (étape 6).
  Chacun indique son nom au premier accès (« Qui suis-je ? ») : le journal de l'outil et le filtre « Mes
  comptes » s'appuient sur ce choix.
- **Une clé par personne** : créez une **organisation GitHub** gratuite (https://github.com/organizations/new),
  transférez-y le dépôt de données, invitez les contract managers ; chacun crée sa propre clé avec
  *Resource owner* = l'organisation. Chaque modification est alors signée de son auteur dans GitHub.

## 3. Publier le site

1. Créez un second dépôt sur **https://github.com/new** : nom `suivi-cm`, **Public**, cochez
   *Add a README file*, puis **Create repository**.
2. Décompressez l'archive livrée. Dans le dépôt `suivi-cm`, cliquez sur **Add file › Upload files** et
   glissez **le contenu du dossier `site/`** (les fichiers `index.html`, `config.js`, `favicon.svg`,
   `manifest.webmanifest` et les dossiers `assets/` et `vendor/`), puis **Commit changes**.
3. **Settings › Pages** : *Source* = **Deploy from a branch**, *Branch* = `main`, dossier `/ (root)`,
   **Save**.
4. Après une à deux minutes, l'adresse du site s'affiche en haut de la page *Pages*
   (ex. `https://contact44.github.io/suivi-cm/`).

> Variante pour une équipe technique : déposer l'archive complète et choisir *Source* = **GitHub Actions** ;
> le fichier `.github/workflows/pages.yml` lance les tests unitaires puis publie le dossier `site/`.

## 4. Indiquer le dépôt de données

Dans le dépôt `suivi-cm`, ouvrez `config.js`, cliquez sur le crayon (*Edit*) et vérifiez :

```js
github: {
  owner: 'contact44',          // votre compte (ou l'organisation)
  repo: 'suivi-cm-donnees',    // le dépôt PRIVÉ créé à l'étape 1
  ...
},
seasonId: '2027',
```

**Commit changes** : le site est mis à jour en une minute.

## 5. Premier accès et import du fichier Excel

1. Ouvrez l'adresse du site, collez la clé d'accès, **Se connecter**. L'outil prépare le dépôt de données
   (dossier `suivi-cm/2027`).
2. Sur l'**Accueil**, cliquez sur **Importer le fichier Suivi CM** et choisissez
   `0._Fichier_suivi_CM_2027_….xlsm`. L'onglet « 1.Suivi CM » et ses colonnes sont reconnus
   automatiquement : les colonnes calculées (« auto ») et les séparateurs sont ignorés car l'outil les
   recalcule ; les CM référents sont créés dans l'équipe et les juristes ajoutés à la liste.
3. Vérifiez la correspondance proposée, puis **Importer**. Les 211 lignes du fichier actuel sont créées.
4. **Paramètres › Équipe** : complétez l'e-mail de chaque CM ; **Paramètres › Accueil et liens** : les
   liens vers les dossiers réseau.

> Fichier protégé par le DRM Samsung (NASCA) : le navigateur ne peut pas le lire. Ouvrez-le dans Excel,
> sélectionnez le tableau de l'onglet 1.Suivi CM (en-têtes compris), copiez, puis dans l'assistant d'import
> choisissez **Coller depuis Excel**.

## 6. Donner l'accès à l'équipe

**Paramètres › Connexion et partage › Lien d'accès pour l'équipe** : collez la clé, l'outil fabrique un lien
`…/#acces=…`. Envoyez-le à chaque contract manager par un canal privé (message direct Teams, en main
propre ; jamais dans un e-mail collectif ni un document partagé). À l'ouverture du lien, la clé est
enregistrée dans le navigateur puis retirée de la barre d'adresse : il suffit ensuite d'ouvrir l'adresse du
site (ajoutez-la aux favoris).

Pour retirer l'accès : **github.com › Settings › Developer settings › Personal access tokens** ›
supprimer la clé, puis en créer une nouvelle et renvoyer un lien.

## Fonctionnement au quotidien

- **Temps réel** : lecture du dépôt toutes les 5 secondes (réglable : `pollMs` dans `config.js`), envoi
  immédiat des modifications. L'indicateur en haut de l'écran signale les modifications en attente.
- **Historique** : chaque modification est un commit du dépôt de données : rien n'est perdu, chaque version
  reste consultable sur GitHub. L'onglet **Journal** de l'outil présente ces modifications en clair.
- **Sauvegarde** : **Paramètres › Import, export et sauvegarde** › *Sauvegarde complète* (.json) et export
  Excel mis en forme, à tout moment.
- **Quota GitHub** : 5 000 requêtes par heure et par clé ; les lectures sans changement ne sont pas
  décomptées. En cas de dépassement (rare), l'outil patiente et reprend seul, sans perte.
- **Expiration de la clé** : l'outil affiche l'écran de connexion ; les modifications non envoyées restent
  sur le poste. Créez une nouvelle clé (étape 2) et renvoyez le lien d'accès.

## Saison suivante

1. **Paramètres › Import, export et sauvegarde › Préparer la saison suivante** : téléchargez le fichier de
   départ (comptes ouverts, statuts et dates de la saison basculés dans l'historique N-1, comptes fermés
   retirés).
2. Dans `config.js`, remplacez `seasonId: '2027'` par `'2028'` : l'outil démarre une saison vierge dans le
   même dépôt (la saison 2027 reste consultable en remettant `'2027'`).
3. **Paramètres › Import, export et sauvegarde › Restaurer…** : choisissez le fichier de départ.

## Dépannage

| Situation | Solution |
|---|---|
| « Dépôt de données introuvable » | Vérifiez `owner` / `repo` dans `config.js` et que la clé donne accès à ce dépôt. |
| « Enregistrement refusé par GitHub » | La clé est en lecture seule : permission **Contents : Read and write**. |
| Bandeau rouge « Dépôt public » | Dépôt de données › Settings › General › Danger Zone › *Change visibility* › Private. |
| GitHub injoignable | Réseau ou proxy d'entreprise : `api.github.com` doit être accessible. Les modifications attendent sur le poste. |
| Essayer sans GitHub | Remplacez `github: { … }` par `github: null` dans `config.js` : mode local (données dans le navigateur, non partagées). |
