# Mise en ligne et configuration

Ce guide décrit, étape par étape, comment publier l'outil sur GitHub Pages puis le relier à une base
Firebase pour que plusieurs personnes modifient les mêmes données **en même temps**. Comptez environ
30 minutes la première fois. Aucune compétence de développement n'est nécessaire.

> **Sans Firebase**, l'application fonctionne déjà en ligne, mais en **mode local** : chaque personne
> voit ses propres données, enregistrées dans son navigateur. Le partage en temps réel exige l'étape 2.

---

## 1. Publier le site sur GitHub Pages

Le site publié est le dossier `site/` du dépôt. Le fichier `.github/workflows/pages.yml` le publie
automatiquement à chaque mise à jour de la branche `main`.

1. Sur GitHub, ouvrez le dépôt **contact44/Templates**.
2. Fusionnez la branche de travail `claude/great-planck-644319` dans `main`
   (onglet **Pull requests › New pull request**, base `main` ← compare `claude/great-planck-644319`,
   puis **Merge**).
3. **Settings › Pages › Build and deployment › Source** : choisissez **GitHub Actions**
   (déjà le cas si l'ancien projet était publié par ce biais).
4. Onglet **Actions** : attendez que le workflow « Publication GitHub Pages » soit vert (1 à 2 minutes).
5. Le site est disponible à l'adresse **https://contact44.github.io/Templates/**.

> Le code du site est public (comme tout site GitHub Pages gratuit), mais il **ne contient aucune donnée** :
> les contrats sont stockés dans Firebase, derrière une connexion et des règles d'accès.

---

## 2. Créer la base partagée Firebase (gratuite)

### 2.1 Créer le projet

1. Allez sur **https://console.firebase.google.com** avec un compte Google (idéalement un compte
   dédié à l'équipe juridique plutôt qu'un compte personnel).
2. **Créer un projet** (« Add project ») : nom `saison-contractuelle` par exemple. Google Analytics :
   inutile, vous pouvez le désactiver.

### 2.2 Activer la connexion par e-mail

1. Menu **Build › Authentication** (« Créer » › « Authentication ») › **Commencer**.
2. Onglet **Sign-in method / Mode de connexion** › **E-mail/Mot de passe** › activez la première option ›
   **Enregistrer**.
3. Onglet **Users / Utilisateurs** › **Ajouter un utilisateur** : créez un compte pour vous et pour
   chacun des deux contract managers (adresse e-mail + mot de passe provisoire d'au moins 8 caractères).
   Chacun pourra ensuite changer son mot de passe depuis l'application (menu de l'avatar, en haut à droite).
4. Onglet **Settings / Paramètres › Authorized domains / Domaines autorisés** › **Ajouter un domaine** :
   `contact44.github.io`.
5. Facultatif mais recommandé : **Settings › User actions** › décochez **Enable create (sign-up)** si
   l'option est proposée, pour que personne ne puisse se créer de compte lui-même. (Même sans cela, les
   règles de l'étape 2.4 bloquent toute personne absente de la liste.)

### 2.3 Créer la base Firestore

1. Menu **Build › Firestore Database** › **Créer une base de données**.
2. Emplacement : choisissez une région européenne, par exemple **europe-west9 (Paris)** ou **eur3 (Europe)**.
   Ce choix est définitif.
3. Démarrez en **mode production** (les règles de l'étape suivante ouvriront l'accès à votre équipe).

### 2.4 Publier les règles de sécurité

1. Ouvrez le fichier `firebase/firestore.rules` du dépôt.
2. Remplacez les trois adresses de la liste `ALLOWED_EMAILS` par les adresses **exactes** des comptes
   créés à l'étape 2.2 (en minuscules) :

   ```
   // ALLOWED_EMAILS — début
   'prenom.nom@samsung.com',
   'contract.manager1@samsung.com',
   'contract.manager2@samsung.com'
   // ALLOWED_EMAILS — fin
   ```

3. Dans la console : **Firestore Database › Règles** › effacez le contenu › collez le fichier modifié ›
   **Publier**.

Ces règles garantissent que :
- seules les personnes listées peuvent lire ou modifier les données ;
- le **journal des modifications ne peut être ni modifié ni effacé** (traçabilité) ;
- chacun ne peut mettre à jour que sa propre présence (« qui est en ligne »).

Pour ajouter ou retirer une personne plus tard : créez/supprimez son compte (étape 2.2) et mettez la liste
à jour (étape 2.4).

### 2.5 Relier le site à Firebase

1. **Paramètres du projet** (roue dentée en haut à gauche) › **Général** › **Vos applications** ›
   icône **Web `</>`** › nom « Saison contractuelle » (pas besoin de Firebase Hosting) › **Enregistrer**.
2. Firebase affiche un bloc `firebaseConfig`. Copiez ses valeurs dans le fichier **`site/config.js`** :

   ```js
   window.APP_CONFIG = {
     firebase: {
       apiKey: "AIzaSy…",
       authDomain: "saison-contractuelle.firebaseapp.com",
       projectId: "saison-contractuelle",
       storageBucket: "saison-contractuelle.firebasestorage.app",
       messagingSenderId: "1234567890",
       appId: "1:1234567890:web:abc123"
     },
     seasonId: '2027',
     forceLongPolling: false,
   };
   ```

   Sur GitHub, vous pouvez modifier ce fichier directement dans le navigateur (icône crayon), puis
   **Commit changes** sur `main`. Le site se met à jour en une à deux minutes.

> Ces valeurs ne sont **pas secrètes** : Firebase les conçoit pour être visibles dans le navigateur.
> La protection repose sur la connexion et sur les règles de l'étape 2.4.

---

## 3. Premier démarrage

1. Ouvrez **https://contact44.github.io/Templates/** et connectez-vous.
   Le premier utilisateur connecté initialise la saison (paramètres par défaut).
2. **Paramètres › Équipe** : renseignez les noms et **les adresses e-mail de connexion** des contract
   managers. L'application reconnaît ainsi qui est connecté (filtre « Mes contrats », journal, présence).
3. **Paramètres › Saison et échéances** : vérifiez les jalons (CGV au 1er décembre 2026, date butoir au
   1er mars 2027, objectif interne…).
4. **Paramètres › Listes de valeurs** et **Colonnes** : ajustez les statuts, canaux, divisions, types de
   contrat et colonnes pour qu'ils correspondent exactement à votre fichier Excel.
5. **Importez votre fichier** : bouton **Importer** du suivi (ou Paramètres › Import, export et sauvegarde).

### Importer le fichier Excel protégé par le DRM Samsung

Le fichier `0. Fichier_Suivi_Saison_Contractuelle_2027.xlsm` est chiffré par le DRM Samsung (NASCA) :
seul Excel, sur un poste Samsung, peut l'ouvrir. Le navigateur ne peut donc pas le lire directement.
Deux solutions :

- **Copier-coller (recommandé)** : ouvrez le fichier dans Excel, sélectionnez le tableau **avec sa ligne
  d'en-tête**, copiez (Ctrl+C), puis dans l'application : **Importer › Coller depuis Excel**, collez
  (Ctrl+V) et validez. Les colonnes sont reconnues automatiquement ; vous pouvez corriger la
  correspondance avant d'importer, et créer les colonnes qui n'existent pas encore.
- **Copie non protégée** : si votre politique de sécurité l'autorise, enregistrez une copie sans DRM
  (.xlsx) et importez-la.

Si le DRM bloque aussi le presse-papiers, faites l'import feuille par feuille ou saisissez les données
directement dans l'outil.

---

## 4. Points de vigilance

- **Confidentialité** : les données des négociations seront hébergées par Google (Firebase), dans la
  région choisie à l'étape 2.3. Faites valider ce choix par la sécurité informatique et, le cas échéant,
  par le DPO avant d'y saisir des informations réelles.
- **Réseau de l'entreprise** : l'application doit pouvoir joindre `contact44.github.io`,
  `firestore.googleapis.com`, `identitytoolkit.googleapis.com` et `securetoken.googleapis.com`.
  Si l'indicateur reste sur « Connexion… » ou « Hors ligne » alors qu'Internet fonctionne, passez
  `forceLongPolling` à `true` dans `site/config.js` ; si le problème persiste, demandez l'ouverture de ces
  adresses au support informatique.
- **E-mails « mot de passe oublié »** : ils sont envoyés par `noreply@<projet>.firebaseapp.com` et peuvent
  arriver dans les courriers indésirables, ou être filtrés. L'administrateur peut aussi réinitialiser un
  mot de passe depuis la console (Authentication › Users).
- **Coût** : le forfait gratuit (Spark) suffit largement pour trois utilisateurs et quelques centaines de
  contrats (50 000 lectures et 20 000 écritures par jour). L'application limite volontairement ses lectures
  (journal chargé par pages) pour rester dans ce cadre toute la saison.
- **Sauvegardes** : téléchargez régulièrement une sauvegarde (Paramètres › Import, export et sauvegarde ›
  Sauvegarde complète) et un export Excel, par exemple chaque vendredi.

---

## 5. Saison suivante

Pour démarrer la saison 2028 sans effacer 2027 :

1. Exportez la saison 2027 (sauvegarde .json et export Excel) pour archive.
2. **Paramètres › Import, export et sauvegarde › Préparer la saison suivante** : téléchargez le fichier de
   départ 2028 (mêmes clients, équipe, listes et colonnes ; jalons décalés d'un an ; statuts, dates et
   actions remis à zéro).
3. Dans `site/config.js`, remplacez `seasonId: '2027'` par `seasonId: '2028'` et publiez.
4. Connectez-vous, puis **Paramètres › Import, export et sauvegarde › Restaurer…** avec le fichier de départ.
   Vérifiez les jalons (les dates légales peuvent évoluer d'une année sur l'autre).

La saison 2027 reste consultable en remettant temporairement `seasonId: '2027'`.

---

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Bandeau « Mode local » après configuration | `site/config.js` non mis à jour sur `main`, ou cache du navigateur | Vérifier le fichier sur GitHub, recharger avec Ctrl+F5 |
| « Accès non autorisé » après connexion | Adresse absente des règles Firestore | Étape 2.4 (adresse exacte, en minuscules) |
| Erreur de connexion « domaine non autorisé » | `contact44.github.io` absent des domaines autorisés | Étape 2.2, point 4 |
| Indicateur « Hors ligne » permanent | Proxy ou pare-feu de l'entreprise | `forceLongPolling: true`, puis support informatique |
| Les collègues ne voient pas mes modifications | L'un des deux est en mode local ou hors ligne | Vérifier l'indicateur en haut à droite et la mention « Base partagée » |

---

## 7. Pour aller plus loin (facultatif)

Les tests automatiques se lancent depuis un poste disposant de Node.js 22 :

```bash
npm install
npm run test:unit      # calculs, dates, import Excel, automatisations
npm run test:e2e       # parcours complet dans un navigateur (mode local)
npm run test:sync      # deux utilisateurs simultanés sur l'émulateur Firebase (Java 21 requis)
```

Les dépendances embarquées (`site/vendor/`) se reconstruisent avec `npm run vendor`.
