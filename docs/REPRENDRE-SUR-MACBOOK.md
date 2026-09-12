# Reprendre Manjéo sur le MacBook

La version avec base de données et trois espaces se trouve sur la branche **`codex/database-roles-mvp`** du dépôt [is4acs/manjeo](https://github.com/is4acs/manjeo/tree/codex/database-roles-mvp).

## Première ouverture

1. Installer ou ouvrir l’application Codex sur le MacBook et se connecter au même compte ChatGPT. [Guide officiel](https://learn.chatgpt.com/docs/quickstart).
2. Prévoir Git, Node.js 22.13 ou supérieur (avec npm) et Python 3.9 ou supérieur.
3. Dans le Terminal du MacBook, cloner le projet dans un dossier hors iCloud :

```sh
mkdir -p ~/Developer
cd ~/Developer
git clone --branch codex/database-roles-mvp https://github.com/is4acs/manjeo.git
cd manjeo
npm run build
npm start
```

Le build installe ses dépendances dans un cache local. Garder le terminal du serveur ouvert et visiter [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Les trois comptes de test et le catalogue sont créés automatiquement.

4. Dans Codex, ouvrir le dossier **`~/Developer/manjeo`** avec **⌘ O**. [Raccourcis officiels](https://learn.chatgpt.com/docs/reference/commands).
5. Commencer une tâche avec ce message :

> Lis README.md et docs/REPRENDRE-SUR-MACBOOK.md. Reprends le projet Manjéo sur la branche codex/database-roles-mvp. Le MVP local utilise React, une API Python et SQLite, avec les espaces client, restaurateur et admin. Commence par vérifier l’état Git et lancer le site local, puis attends mes prochaines modifications.

## Alterner entre les deux Mac

Avant de quitter un appareil, demander à Codex :

> Vérifie les changements, crée un commit et pousse mon travail sur la branche actuelle de is4acs/manjeo pour que je puisse reprendre sur mon autre Mac.

Sur l’autre appareil, avant de modifier le projet :

```sh
cd ~/Developer/manjeo
git status
git pull --ff-only
npm run build
npm start
```

Si Git signale des changements locaux ou un conflit, demander à Codex de les conserver et de réconcilier les versions avant de continuer. Éviter de modifier les mêmes fichiers simultanément sur les deux Mac.

## Ce qui suit le projet

GitHub conserve le code et la documentation. Le build et les dépendances se recréent sur chaque appareil. Cloner un dépôt ne copie pas l’historique de cette conversation Codex ; le README et ce guide fournissent le contexte de reprise. [Contexte des projets](https://learn.chatgpt.com/docs/projects).

La base **`.data/manjeo.sqlite3`** est locale et exclue de Git. Le MacBook aura les mêmes trois comptes de démonstration, mais un historique de commandes neuf. Pour transférer aussi les commandes existantes, arrêter le serveur de l’appareil source, copier le dossier `.data` en entier, puis le placer dans le clone du MacBook avant son lancement. Sauvegarder tout dossier `.data` déjà présent avant de le remplacer. Ne pas publier cette base sur GitHub.

Les serveurs localhost de chaque appareil sont indépendants : le MacBook lance son propre serveur, même lorsque l’autre Mac est éteint. Cette branche est un MVP local ; la version statique publiée sur Vercel ne fournit pas l’API Python.

## Comptes de démonstration

Mot de passe commun : **`ManjeoDemo2026!`**

| Espace | E-mail |
| --- | --- |
| Client | `client@manjeo.test` |
| Restaurateur Ti Kaz Kréol | `restaurant@manjeo.test` |
| Administration | `admin@manjeo.test` |
