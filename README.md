# manjéo — Démonstration en ligne

Application de commande de repas pour Cayenne, Rémire-Montjoly et Matoury, avec quatre espaces reliés : client, restaurateur, livreur et administration.

**Adresse du projet : [https://manjeo.vercel.app](https://manjeo.vercel.app).** Le site s’utilise depuis un ordinateur ou un téléphone, sans lancer de serveur local. Pour reprendre le développement sur un autre Mac, suivre le [guide MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

L’interface et l’API Python sont déployées sur Vercel. Les comptes, menus et commandes sont conservés dans PostgreSQL chez Neon et partagés entre les appareils. Les six restaurants, produits, prix, avis et délais sont fictifs ; les photographies sont illustratives. Le paiement et la livraison restent simulés.

## Quatre comptes pour tester

Mot de passe commun : **`ManjeoDemo2026!`**

| Rôle | Adresse de connexion | Accès |
| --- | --- | --- |
| Client | `client@manjeo.test` | Catalogue, panier, commande et historique du compte |
| Restaurateur | `restaurant@manjeo.test` | Commandes, carte et réglages de **Ti Kaz Kréol** |
| Livreur | `livreur@manjeo.test` | Disponibilité, offres, retrait et remise avec code client |
| Administrateur | `admin@manjeo.test` | Commandes, cartes, comptes et affectation des livreurs |

Ces comptes de démonstration sont partagés entre les testeurs : saisir uniquement un nom, un téléphone et une adresse fictifs. Le rôle est vérifié côté serveur. Les mots de passe sont hachés ; les sessions utilisent des cookies HttpOnly et Secure en ligne.

## Passer une commande de bout en bout

1. Ouvrir le site et se connecter avec le compte client. Choisir **Ti Kaz Kréol** et ajouter un poulet boucané au panier.
2. Renseigner des coordonnées fictives et une commune, puis confirmer la commande test. Conserver son numéro.
3. Se connecter au compte restaurateur. Accepter la commande, démarrer la préparation et la marquer **Prête au retrait**.
4. Se connecter au compte livreur, activer sa disponibilité et prendre cette course. Le retrait est possible lorsque le restaurant l’a marquée prête.
5. Après le retrait, ouvrir le suivi côté client pour lire son code à quatre chiffres. Dans l’espace livreur, saisir ce code pour confirmer la remise fictive. Le restaurant et le livreur ne peuvent pas lire le code dans l’API.
6. L’admin retrouve la commande, son livreur et les événements. Il peut affecter ou réaffecter une course avant son retrait avec un motif ; il ne peut pas valider une livraison à la place du livreur.

Le compte restaurateur fourni gère uniquement Ti Kaz Kréol. Choisir cette enseigne pour tester le traitement complet. Le catalogue comprend aussi Smash Club, Bowl Tropical, Ciao Cayenne, Crispy Kaz et La Marée Cayennaise. Les commandes confirmées sont visibles depuis un autre appareil avec le même compte.

Un livreur ne peut avoir qu’une course active. Les offres affichent le restaurant et la commune de destination ; les coordonnées de livraison deviennent visibles après affectation. Il peut libérer une course avant le retrait avec un motif. Le client peut annuler une commande encore en attente ; le restaurant ou l’admin peuvent l’annuler avant le retrait. Une livraison terminée ne peut pas être modifiée.

## Direction visuelle

L’interface suit la direction « Punch » : fond crème, un seul jaune en aplat, encre noire pour tout le
texte, titres Archivo Black en capitales sur Figtree, bordures de 2 px et pastilles. Les jetons sont
déclarés une seule fois dans `:root` au début de `app/globals.css` ; aucun composant ne doit coder une
couleur en dur. Les règles complètes, la typographie, les états et les écarts assumés par rapport au
handoff sont dans [la direction « Punch »](docs/DIRECTION-PUNCH.md).

## Délais, codes promo et adresses

- **Le restaurant a dix minutes pour accepter.** Passé ce délai la commande s’annule d’elle-même, l’historique porte la mention « annulation automatique » et le code promo utilisé est rendu. Le client voit le compte à rebours dans son suivi, le restaurateur le voit sur la commande. L’hébergement n’exécutant aucune tâche de fond, l’expiration est constatée à la première requête qui suit l’échéance.
- **Une estimation apparaît à l’acceptation** (préparation annoncée + quinze minutes de course). Elle est affichée au client, au restaurateur et au livreur, et le retard est signalé aux trois.
- **Trois codes de démonstration** : `BIENVENUE` (20 % dès 15 €, une fois par compte), `LIVRAISON` (livraison offerte dès 25 €) et `TIKAZ5` (5 € chez Ti Kaz Kréol dès 20 €). Le code se saisit dans le panier ; la remise affichée n’est qu’un aperçu, le serveur la recalcule à la confirmation et refuse tout total qui ne correspond pas. Un code est rendu quand la commande est annulée.
- **Un client ne peut pas cumuler plus de cinq commandes en cours**, pour que la démonstration partagée reste lisible.
- **La saisie d’adresse propose des complétions** pour Cayenne, Rémire-Montjoly et Matoury. Ce répertoire est une liste fixe embarquée dans l’API (`server/addresses.py`), sans appel réseau ni clé : en production, le remplacer par la Base Adresse Nationale, l’interface consomme déjà la même forme de réponse.

## Modifier la carte

Dans l’espace restaurateur, ouvrir **Ma carte** : créer, renommer et réordonner des catégories ; ajouter ou modifier un produit, sa description, son prix, sa photo, ses allergènes, sa disponibilité et ses groupes d’options. Chaque groupe définit un minimum, un maximum et les suppléments de prix de ses choix. Les produits peuvent être archivés puis restaurés. Les photos JPEG, PNG ou WebP sont enregistrées dans la base après validation et réencodage (1 Mo maximum à l’envoi).

Les modifications restent un brouillon jusqu’à **Publier la carte**. Si un autre onglet publie entre-temps, un conflit empêche l’écrasement et permet de conserver le brouillon pour le comparer à la nouvelle carte. L’admin dispose du même éditeur pour tous les restaurants.

Une modification ne change jamais le prix ni les options d’une commande déjà confirmée. Un panier contenant un produit modifié demande une actualisation explicite avant de commander ; les produits retirés ou options supprimées doivent être revus. Le serveur vérifie la version, les options, le prix unitaire et le total, puis calcule les montants en centimes. La livraison fictive ajoute 1 € hors Cayenne.

Le restaurant peut aussi modifier sa présentation, son adresse de retrait, son délai et l’ouverture des commandes. Les règles détaillées et les références utilisées sont dans [le contrat des quatre espaces](docs/FOUR-ROLES-CONTRACT.md).

## Coordonnées, messagerie et langues

Chaque compte porte un téléphone et une langue, modifiables depuis **Mon compte** — accessible aussi
depuis les espaces restaurateur, livreur et administration.

- **Les numéros ne sont ouverts que le temps utile.** Le client joint le restaurant pendant que sa
  commande est en cours, et le livreur seulement entre le retrait et la remise. Le livreur affecté
  joint le client et le restaurant. Hors de cette fenêtre, le serveur ne renvoie aucun numéro.
- **Une conversation est attachée à chaque commande.** Elle s’ouvre à l’acceptation, se ferme une
  demi-heure après la livraison, et n’est lisible que par le client, le restaurant, le livreur
  affecté et l’administration. Les messages non lus sont comptés pour chaque rôle.
- **Chacun écrit dans sa langue.** Un message est conservé tel qu’il a été écrit et traduit à la
  lecture. Les **réponses rapides** sont traduites à la main en français, créole haïtien, créole
  guyanais, portugais, anglais, espagnol et chinois : un livreur brésilien qui envoie « Estou a
  caminho » est lu « Mwen sou wout la » par un client haïtien, sans aucun moteur. Le texte libre
  passe par le moteur du navigateur (API Translator) quand la paire existe, sinon par un moteur
  configuré côté serveur (`MANJEO_TRANSLATE_URL`, `MANJEO_TRANSLATE_KEY`). Sans moteur, le message
  reste dans sa langue et l’interface le dit ; l’original est toujours consultable.

Les traductions des réponses rapides doivent être relues par des locuteurs natifs avant une mise en
service réelle.

## Données et déploiement

La base Neon dédiée au projet utilise le schéma PostgreSQL `manjeo`. Les quatre comptes et le catalogue initial sont créés à l’initialisation. Les migrations ajoutent le rôle livreur et les nouveaux champs aux bases existantes sans remplacer les cartes modifiées, comptes, sessions ou commandes. Les commandes sont conservées entre les déploiements Vercel. Les prévisualisations utilisent le schéma distinct `manjeo_preview` (`MANJEO_DB_SCHEMA` dans l’environnement Preview), pour séparer leurs essais de la démonstration principale.

La branche **`main`** du dépôt [is4acs/manjeo](https://github.com/is4acs/manjeo/tree/main) déclenche les déploiements Production de Vercel. Les branches `codex/…`, dont `codex/four-roles-menu-delivery`, servent au travail et aux déploiements Preview. Tester la Preview, puis intégrer les changements validés dans `main` et pousser cette branche pour publier sur `manjeo.vercel.app`. Vérifier le résultat du déploiement avant de tester la nouvelle version en Production.

Configuration serveur dans les variables d’environnement Vercel :

- `DATABASE_URL` : connexion PostgreSQL fournie par Neon ; `POSTGRES_URL` est accepté comme alternative.
- `APP_ORIGIN` : `https://manjeo.vercel.app` pour l’environnement Production.

La connexion à la base reste côté serveur : ne pas la préfixer avec `VITE_`, l’ajouter au code ou la publier dans Git. Sur Vercel, une connexion de base manquante provoque une erreur explicite ; l’API ne crée pas de base SQLite temporaire à la place.

Vercel compile l’interface avec `npm run build:vercel` et sert l’API via `api/index.py`. Le runtime Python est fixé à 3.12 et les dépendances Python sont déclarées dans `requirements.txt`.

Les anciens essais SQLite de l’ordinateur ne sont pas importés dans Neon. La migration de cet historique n’est pas implémentée. Le panier et la destination restent propres au navigateur ; les commandes confirmées et leur suivi sont partagés via la base en ligne.

## Codex Cloud et reprise sur MacBook

Le dépôt inclut `AGENTS.md` pour transmettre le contexte à un nouvel agent, `scripts/codex-setup.sh` pour installer les dépendances, et `scripts/codex-check.sh` pour exécuter les tests autonomes et compiler. La connexion GitHub et l’environnement Cloud se configurent dans Codex Web ; suivre le [guide Cloud et MacBook](docs/REPRENDRE-SUR-MACBOOK.md#activer-codex-cloud).

## Modifier et vérifier le code

Prérequis : Git, Node.js 22.13 ou supérieur avec npm, et Python 3.12 pour le backend et le traitement des photos. Cloner le dépôt dans un dossier hors iCloud et ouvrir ce dossier dans Codex ; voir le [guide MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

```sh
npm install
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
npm test
npm run build:vercel
```

Le build vérifie les types TypeScript, puis génère l’interface avec Vite. Les tests couvrent le panier client, les permissions, la carte, les migrations, les conflits d’affectation et le code de remise. Les tests SQLite utilisent des bases temporaires. Les tests d’intégration PostgreSQL nécessitent une connexion de test séparée, fournie par `MANJEO_TEST_DATABASE_URL`, et les dépendances de `requirements.txt`. Ne pas utiliser la base de démonstration en ligne comme base de test.

Pour installer les dépendances Python dans un environnement dédié :

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s server -p 'test_*.py'
```

## Option : développement local avec SQLite

Le mode local permet des essais indépendants de la démonstration en ligne. Sans variable `DATABASE_URL` ni `POSTGRES_URL`, le serveur local utilise `.data/manjeo.sqlite3`, exclue de Git. Utiliser aussi l’environnement Python 3.12 et les dépendances ci-dessus pour disposer du traitement des photos.

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
