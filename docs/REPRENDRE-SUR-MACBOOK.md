# Reprendre Manjéo sur le MacBook

## Utiliser le site

Ouvrir **[https://manjeo.vercel.app](https://manjeo.vercel.app)** sur le MacBook. Aucun clone, installation ou serveur localhost n’est nécessaire pour commander ou utiliser les espaces restaurateur, livreur et administrateur.

Les comptes et commandes sont conservés dans la base PostgreSQL Neon commune au site. Le même compte retrouve donc son historique depuis chaque appareil. Les comptes sont partagés pour la démonstration : utiliser uniquement des coordonnées fictives.

Mot de passe commun : **`ManjeoDemo2026!`**

| Espace | E-mail |
| --- | --- |
| Client | `client@manjeo.test` |
| Restaurateur Ti Kaz Kréol | `restaurant@manjeo.test` |
| Livreur | `livreur@manjeo.test` |
| Administration | `admin@manjeo.test` |

## Activer Codex Cloud

L’option **Cloud** du menu « Continuer dans » utilise un environnement Codex associé au dépôt GitHub. Cet environnement est distinct de Vercel, qui héberge le site. La préparation du dépôt ne suffit pas à activer l’option : la connexion du compte et la création de l’environnement doivent aboutir dans Codex Web.

1. Ouvrir [Codex Cloud](https://chatgpt.com/codex/cloud) avec le même compte ChatGPT que dans l’application du MacBook.
2. Si Codex demande un second facteur, activer la MFA soi-même. Ne transmettre aucun code de vérification ou de récupération à l’agent.
3. Connecter GitHub avec le compte **is4acs** et sélectionner le dépôt **is4acs/manjeo**. Limiter la sélection à ce dépôt pour cette configuration.
4. Dans les paramètres des environnements, créer ou sélectionner **manjeo**, avec `main` comme branche de référence. Choisir Node 22 (au minimum 22.13) et Python 3.12.
5. Pour le script d’installation et le script de maintenance, utiliser :

```sh
bash scripts/codex-setup.sh
```

6. Tester l’environnement avec :

```sh
bash scripts/codex-check.sh
```

Aucun secret Neon ou Vercel n’est nécessaire pour installer, compiler et tester le projet. Les tests autonomes couvrent l’API avec SQLite ainsi que le panier, les promotions côté interface et la traduction. Les tests PostgreSQL restent ignorés sans une base de test dédiée ; le compte rendu doit les signaler. `AGENTS.md` donne les règles de reprise à l’agent Cloud.

Une fois l’environnement associé au dépôt, revenir dans l’application et rouvrir « Continuer dans » pour sélectionner Cloud et l’environnement Manjéo. Si la liste n’est pas à jour, rouvrir le projet. Depuis le MacBook, retrouver l’environnement dans Codex Cloud avec le même compte ; les changements de code passent ensuite par GitHub et une branche `codex/…`.

Une tâche locale et son historique ne sont pas transférés par un simple clone Git. Pour reprendre une tâche Cloud, l’ouvrir dans Codex Cloud ; pour reprendre un travail local, utiliser le clone et les documents du dépôt décrits ci-dessous.

Les scripts d’installation et de maintenance sont exécutés séparément des commandes de l’agent : le script de vérification sélectionne donc explicitement le Python de `.venv`. [Documentation officielle des environnements Codex](https://learn.chatgpt.com/docs/environments/cloud-environment).

## Continuer le développement dans Codex

La version de référence se trouve sur la branche **`main`** du dépôt [is4acs/manjeo](https://github.com/is4acs/manjeo/tree/main). Vercel publie automatiquement cette branche en Production. Les modifications se préparent sur des branches `codex/…`, avec une Preview pour les tester avant publication.

1. Installer ou ouvrir l’application desktop sur le MacBook, se connecter au même compte ChatGPT et choisir **Codex**. [Guide officiel OpenAI](https://learn.chatgpt.com/docs/quickstart).
2. Prévoir Git et Node.js 22.13 ou supérieur avec npm. Python 3.12 est utilisé pour le backend PostgreSQL et le traitement des photos.
3. Dans le Terminal du MacBook, cloner le code dans un dossier hors iCloud :

```sh
mkdir -p ~/Developer
cd ~/Developer
git clone --branch main https://github.com/is4acs/manjeo.git
```

4. Dans Codex, ouvrir **`~/Developer/manjeo`** avec **⌘ O**. [Raccourcis officiels](https://learn.chatgpt.com/docs/reference/commands).
5. Commencer une tâche avec ce message :

> Lis README.md et docs/REPRENDRE-SUR-MACBOOK.md. Reprends le projet Manjéo à partir de main. Le site de référence est https://manjeo.vercel.app : React, API Python sur Vercel et PostgreSQL Neon, avec les espaces client, restaurateur, livreur et admin. Lis aussi docs/FOUR-ROLES-CONTRACT.md pour les règles des cartes, affectations et livraisons. Vérifie l’état Git et récupère les changements distants en conservant mon travail local. Pour mes prochaines modifications, travaille sur une branche codex/, teste le code et sa Preview Vercel. La publication du site passe par l’intégration des changements validés dans main. N’ajoute aucune connexion de base secrète au dépôt.

Le site en ligne continue à fonctionner sans laisser un terminal ouvert sur le MacBook. Un clone sert à modifier le code ; il ne donne pas automatiquement accès aux variables secrètes du projet Vercel.

## Alterner entre les deux Mac

Avant de quitter un appareil, demander à Codex :

> Vérifie et teste mes changements, crée un commit et pousse ma branche de travail codex/ sur GitHub. Indique son nom pour que je reprenne la même branche sur mon autre Mac.

Sur l’autre appareil, ouvrir le projet dans Codex et lui demander de reprendre cette même branche. Avant de modifier les fichiers, vérifier l’état Git et récupérer les changements distants :

```sh
cd ~/Developer/manjeo
git status
git fetch origin
git pull --ff-only
```

Si Git signale des changements locaux ou un conflit, demander à Codex de les conserver et de réconcilier les versions avant de continuer. Éviter de modifier les mêmes fichiers simultanément sur les deux Mac.

Quand les changements sont prêts à publier, demander à Codex de vérifier la Preview, d’intégrer les changements validés dans `main`, de pousser `main` et de contrôler le déploiement Production. Pousser une branche `codex/…` sauvegarde le travail et prépare une Preview ; cela ne remplace pas automatiquement le site de Production.

Les commandes de compilation et de test, ainsi que le mode local facultatif, sont détaillés dans [README.md](../README.md). Il n’est pas nécessaire de lancer localhost pour consulter le site en ligne.

## Ce qui suit le projet

- **Code et documentation** : synchronisés via GitHub. Les dépendances et fichiers compilés sont recréés quand nécessaire.
- **Commandes et comptes du site** : conservés dans Neon et partagés entre les appareils, indépendamment des clones Git.
- **Conversation Codex** : cloner le dépôt ne copie pas l’historique de cet échange. Le README et ce guide fournissent le contexte de reprise. [Contexte des projets](https://learn.chatgpt.com/docs/projects).
- **Panier, destination et connexion du navigateur** : propres au navigateur utilisé. Se reconnecter au même compte sur le MacBook pour retrouver les commandes confirmées.

L’ancienne base locale **`.data/manjeo.sqlite3`** est exclue de Git et reste indépendante de la base en ligne. Aucun transfert SQLite n’est nécessaire pour travailler sur le site partagé. Les anciennes commandes locales ne sont pas importées dans Neon ; cette migration n’est pas implémentée.
