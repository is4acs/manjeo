# Reprendre Manjéo sur le MacBook

## Utiliser le site

Ouvrir **[https://manjeo.vercel.app](https://manjeo.vercel.app)** sur le MacBook. Aucun clone, installation ou serveur localhost n’est nécessaire pour commander ou utiliser les espaces restaurateur et administrateur.

Les comptes et commandes sont conservés dans la base PostgreSQL Neon commune au site. Le même compte retrouve donc son historique depuis chaque appareil. Les comptes sont partagés pour la démonstration : utiliser uniquement des coordonnées fictives.

Mot de passe commun : **`ManjeoDemo2026!`**

| Espace | E-mail |
| --- | --- |
| Client | `client@manjeo.test` |
| Restaurateur Ti Kaz Kréol | `restaurant@manjeo.test` |
| Administration | `admin@manjeo.test` |

## Continuer le développement dans Codex

La version de référence se trouve sur la branche **`main`** du dépôt [is4acs/manjeo](https://github.com/is4acs/manjeo/tree/main). Vercel publie automatiquement cette branche en Production. Les modifications se préparent sur des branches `codex/…`, avec une Preview pour les tester avant publication.

1. Installer ou ouvrir l’application desktop sur le MacBook, se connecter au même compte ChatGPT et choisir **Codex**. [Guide officiel OpenAI](https://learn.chatgpt.com/docs/quickstart).
2. Prévoir Git et Node.js 22.13 ou supérieur avec npm. Python 3.12 est recommandé pour modifier et tester le backend PostgreSQL.
3. Dans le Terminal du MacBook, cloner le code dans un dossier hors iCloud :

```sh
mkdir -p ~/Developer
cd ~/Developer
git clone --branch main https://github.com/is4acs/manjeo.git
```

4. Dans Codex, ouvrir **`~/Developer/manjeo`** avec **⌘ O**. [Raccourcis officiels](https://learn.chatgpt.com/docs/reference/commands).
5. Commencer une tâche avec ce message :

> Lis README.md et docs/REPRENDRE-SUR-MACBOOK.md. Reprends le projet Manjéo à partir de main. Le site de référence est https://manjeo.vercel.app : React, API Python sur Vercel et PostgreSQL Neon, avec les espaces client, restaurateur et admin. Vérifie l’état Git et récupère les changements distants en conservant mon travail local. Pour mes prochaines modifications, travaille sur une branche codex/, teste le code et sa Preview Vercel. La publication du site passe par l’intégration des changements validés dans main. N’ajoute aucune connexion de base secrète au dépôt.

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
