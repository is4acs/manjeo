# manjéo — Démonstration en ligne

Application de commande de repas pour Cayenne, Rémire-Montjoly et Matoury, avec un espace client, un espace restaurateur et une administration.

**Adresse du projet : [https://manjeo.vercel.app](https://manjeo.vercel.app).** Le site s’utilise depuis un ordinateur ou un téléphone, sans lancer de serveur local. Pour reprendre le développement sur un autre Mac, suivre le [guide MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

L’interface et l’API Python sont déployées sur Vercel. Les comptes, menus et commandes sont conservés dans PostgreSQL chez Neon et partagés entre les appareils. Les six restaurants, produits, prix, avis et délais sont fictifs ; les photographies sont illustratives. Le paiement et la livraison restent simulés.

## Trois comptes pour tester

Mot de passe commun : **`ManjeoDemo2026!`**

| Rôle | Adresse de connexion | Accès |
| --- | --- | --- |
| Client | `client@manjeo.test` | Catalogue, panier, commande et historique du compte |
| Restaurateur | `restaurant@manjeo.test` | Commandes et produits de **Ti Kaz Kréol** |
| Administrateur | `admin@manjeo.test` | Vue globale des commandes, restaurants et comptes |

Ces comptes de démonstration sont partagés entre les testeurs : saisir uniquement un nom, un téléphone et une adresse fictifs. Le rôle est vérifié côté serveur. Les mots de passe sont hachés ; les sessions utilisent des cookies HttpOnly et Secure en ligne.

## Passer une commande de bout en bout

1. Ouvrir le site et se connecter avec le compte client. Choisir **Ti Kaz Kréol** et ajouter un poulet boucané au panier.
2. Renseigner des coordonnées fictives et une commune, puis confirmer la commande test. Conserver son numéro.
3. Se déconnecter et ouvrir le compte restaurateur. Retrouver la commande, l’accepter, puis faire avancer les étapes de préparation et de livraison simulée.
4. Ouvrir le compte administrateur pour retrouver la même commande dans la vue globale.
5. Revenir au compte client : l’historique affiche son état courant. On peut aussi ouvrir ce compte sur un autre appareil pour retrouver les commandes de la base en ligne.

Le compte restaurateur fourni gère uniquement Ti Kaz Kréol. Choisir cette enseigne pour tester le traitement complet. Le catalogue comprend aussi Smash Club, Bowl Tropical, Ciao Cayenne, Crispy Kaz et La Marée Cayennaise.

Les grandes portions ajoutent 2 € sur les produits compatibles. La livraison fictive ajoute 1 € hors Cayenne. Le serveur contrôle les produits et options et recalcule les montants en centimes.

## Données et déploiement

La base Neon dédiée au projet utilise le schéma PostgreSQL `manjeo`. Les trois comptes et le catalogue initial sont créés lors de l’initialisation d’une base vide. Les commandes sont conservées entre les déploiements Vercel. Les prévisualisations utilisent le schéma distinct `manjeo_preview` (`MANJEO_DB_SCHEMA` dans l’environnement Preview), pour séparer leurs essais de la démonstration principale.

La branche **`main`** du dépôt [is4acs/manjeo](https://github.com/is4acs/manjeo/tree/main) déclenche les déploiements Production de Vercel. Les branches `codex/…`, dont `codex/database-roles-mvp`, servent au travail et aux déploiements Preview. Tester la Preview, puis intégrer les changements validés dans `main` et pousser cette branche pour publier sur `manjeo.vercel.app`. Vérifier le résultat du déploiement avant de tester la nouvelle version en Production.

Configuration serveur dans les variables d’environnement Vercel :

- `DATABASE_URL` : connexion PostgreSQL fournie par Neon ; `POSTGRES_URL` est accepté comme alternative.
- `APP_ORIGIN` : `https://manjeo.vercel.app` pour l’environnement Production.

La connexion à la base reste côté serveur : ne pas la préfixer avec `VITE_`, l’ajouter au code ou la publier dans Git. Sur Vercel, une connexion de base manquante provoque une erreur explicite ; l’API ne crée pas de base SQLite temporaire à la place.

Vercel compile l’interface avec `npm run build:vercel` et sert l’API via `api/index.py`. Le runtime Python est fixé à 3.12 et les dépendances Python sont déclarées dans `requirements.txt`.

Les anciens essais SQLite de l’ordinateur ne sont pas importés dans Neon. La migration de cet historique n’est pas implémentée. Le panier et la destination restent propres au navigateur ; les commandes confirmées et leur suivi sont partagés via la base en ligne.

## Modifier et vérifier le code

Prérequis : Git, Node.js 22.13 ou supérieur avec npm, et Python 3.12 recommandé pour travailler avec le backend PostgreSQL. Cloner le dépôt dans un dossier hors iCloud et ouvrir ce dossier dans Codex ; voir le [guide MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

```sh
npm install
npm test
npm run build:vercel
```

Le build vérifie les types TypeScript, puis génère l’interface avec Vite. Les tests SQLite utilisent des bases temporaires. Les tests d’intégration PostgreSQL nécessitent une connexion de test séparée, fournie par `MANJEO_TEST_DATABASE_URL`, et les dépendances de `requirements.txt`. Ne pas utiliser la base de démonstration en ligne comme base de test.

Pour installer les dépendances Python dans un environnement dédié :

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s server -p 'test_*.py'
```

## Option : développement local avec SQLite

Le mode local permet des essais indépendants de la démonstration en ligne. Sans variable `DATABASE_URL` ni `POSTGRES_URL`, le serveur local utilise `.data/manjeo.sqlite3`, exclue de Git. Python 3.9 ou supérieur suffit pour ce mode SQLite.

```sh
npm run build
npm start
```

Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/). La commande de build locale utilise un cache hors des dossiers synchronisés pour éviter les blocages iCloud. Garder le terminal ouvert pendant l’utilisation locale ; `Ctrl-C` arrête le serveur.

Pour le rechargement automatique, utiliser `npm install`, puis `npm run dev`. Cette commande lance Vite sur 5173 et l’API Python sur 5174 ; les requêtes `/api` passent par Vite. Arrêter l’autre lanceur local avant de changer de mode, car ils utilisent le même port.

Une base SQLite séparée peut être choisie avec `MANJEO_DB=/chemin/vers/test.sqlite3 npm start`. Les modifications de cette base locale n’affectent pas Neon. Pour recommencer une démo locale, arrêter les serveurs et déplacer `.data` vers une sauvegarde avant de relancer ; conserver les sauvegardes hors de Git.

## Repères dans le dépôt

- `app/` : interfaces React et TypeScript.
- `lib/` : catalogue initial et client API.
- `server/` : API, sessions, contrôles de rôle, persistance et tests.
- `api/index.py` : point d’entrée Python pour Vercel.
- `vercel.json` : compilation et routage du déploiement.
- `scripts/` : lanceurs et compilation pour le travail local.
- `public/images/` : images locales ; sources et licences dans `ASSET-SOURCES.md`.

Cette application est une démonstration publiée en ligne. Elle ne fournit pas de paiement, d’envoi de messages ou de livraison réelle.
