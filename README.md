# manjéo — Démonstration locale

Application de commande de repas pour Cayenne, Rémire-Montjoly et Matoury, avec un espace client, un espace restaurateur et une administration. Les six restaurants, produits, prix, avis et délais sont fictifs ; les photographies sont illustratives.

Les commandes sont enregistrées dans une base SQLite locale et partagées entre les trois espaces. Le paiement et la livraison restent simulés : aucune carte bancaire et aucun service externe ne sont utilisés.

Pour continuer sur un autre ordinateur, suivre le [guide de reprise sur MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

## Démarrer

Prérequis : Node.js 22.13 ou supérieur, npm et Python 3.9 ou supérieur. Python utilise uniquement sa bibliothèque standard.

```sh
npm run build
npm start
```

Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Garder le terminal ouvert ; `Ctrl-C` arrête le serveur. La base et les comptes de démonstration sont créés au premier lancement.

La compilation installe automatiquement les dépendances dans le cache local de l’utilisateur et y copie les sources. Cela évite les blocages de lecture dans les dossiers synchronisés par iCloud. Le dossier `dist` pointe vers le résultat compilé ; aucune base de données ni session n’est copiée dans ce cache.

Après une modification de l’interface, relancer `npm run build`. Pour développer avec rechargement automatique :

```sh
npm install
npm run dev
```

Cette commande lance Vite sur le port 5173 et l’API Python sur le port 5174. Vite transmet les requêtes `/api` à Python ; ouvrir uniquement l’adresse du site sur le port 5173. `Ctrl-C` arrête les deux processus. Arrêter `npm start` avant de lancer `npm run dev`, ou inversement : ils utilisent le même port.

Si la page est inaccessible, vérifier que le terminal du serveur reste ouvert et qu’il n’affiche pas d’erreur. Un port déjà utilisé est signalé ; arrêter l’ancien serveur avant de relancer.

## Trois comptes pour tester

Mot de passe commun : **`ManjeoDemo2026!`**

| Rôle | Adresse de connexion | Accès |
| --- | --- | --- |
| Client | `client@manjeo.test` | Catalogue, panier, commande et historique personnel |
| Restaurateur | `restaurant@manjeo.test` | Commandes et produits de **Ti Kaz Kréol** |
| Administrateur | `admin@manjeo.test` | Vue globale des commandes, restaurants et comptes |

Ces identifiants publics servent uniquement à la démonstration locale. L’application vérifie les rôles côté serveur ; les mots de passe sont hachés et les sessions utilisent des cookies HttpOnly.

## Passer une commande de bout en bout

1. Se connecter avec le compte client, ouvrir **Ti Kaz Kréol** et ajouter un poulet boucané au panier.
2. Renseigner un nom, un téléphone de test, une adresse et une commune, puis confirmer la commande test. Conserver son numéro pour la retrouver.
3. Se déconnecter et se connecter avec le compte restaurateur. Retrouver la commande, l’accepter et faire avancer sa préparation dans l’espace restaurant.
4. Se connecter avec le compte administrateur pour retrouver la même commande dans la vue globale.
5. Revenir au compte client : l’historique affiche la commande et son état courant, y compris après un redémarrage du serveur.

Le restaurant de démonstration gère uniquement Ti Kaz Kréol. Choisir cette enseigne pour tester le traitement avec le compte restaurateur fourni. Le catalogue comprend aussi Smash Club, Bowl Tropical, Ciao Cayenne, Crispy Kaz et La Marée Cayennaise.

Les portions généreuses ajoutent 2 € sur les produits compatibles. La livraison fictive ajoute 1 € hors Cayenne. Les prix, options et frais sont contrôlés et recalculés par le serveur lors de la commande.

## Données locales

La base se trouve dans `.data/manjeo.sqlite3`, exclue de Git avec ses fichiers annexes. Elle conserve les comptes, sessions, restaurants, produits et commandes. Le panier et la destination peuvent aussi être conservés dans le navigateur ; effacer les données du navigateur ne supprime pas les commandes de la base.

Pour utiliser une base séparée :

```sh
MANJEO_DB=/chemin/vers/test.sqlite3 npm start
```

Pour recommencer avec une nouvelle démonstration, arrêter d’abord tous les serveurs, puis déplacer le dossier `.data` vers un dossier de sauvegarde :

```sh
mv .data ".data-backup-$(date +%Y%m%d-%H%M%S)"
npm start
```

Le prochain lancement recrée les données initiales. La sauvegarde conserve l’ancien historique et doit rester privée.

## Architecture et vérification

- `app/` : interface React et TypeScript.
- `lib/` : catalogue et échanges avec l’API ; montants en centimes.
- `server/app.py` : API, sessions, contrôles de rôle et persistance SQLite ; sert aussi le build `dist/`.
- `scripts/start.py` et `scripts/dev.py` : lanceurs locaux.
- `scripts/build.py` : vérification TypeScript et compilation Vite dans le cache local.
- `public/images/` : images locales. Sources et licences dans `ASSET-SOURCES.md`.

```sh
npm test
npm run build
```

Les tests du serveur utilisent des bases temporaires, sans modifier la base de démonstration. Le build vérifie les types TypeScript avant de générer les fichiers du site.

Cette version est destinée aux essais locaux. Elle ne fournit pas de paiement, d’envoi de messages, de livreur réel ou de déploiement de production.
