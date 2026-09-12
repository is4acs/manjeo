# manjéo — Démonstration en ligne

Application de commande de repas pour Cayenne, Rémire-Montjoly et Matoury, avec quatre espaces reliés : client, restaurateur, livreur et administration.

Les quatre espaces proposent une interface en **français, créole haïtien (Kreyòl ayisyen) et portugais du Brésil**. Le menu de langue est intégré à l’en-tête principal, à droite du panier côté client, et reste disponible avant connexion ; le choix global pilote aussi les messages, reste conservé sur l’appareil et se synchronise avec le profil connecté. Il remplace l’ancien sélecteur distinct de sept langues de messagerie.

**Adresse du projet : [https://manjeo.vercel.app](https://manjeo.vercel.app).** Le site s’utilise depuis un ordinateur ou un téléphone, sans lancer de serveur local. Pour reprendre le développement sur un autre Mac, suivre le [guide MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

L’interface et l’API Python sont déployées sur Vercel. Les comptes, menus, coordonnées enregistrées et commandes sont conservés dans PostgreSQL chez Neon et partagés entre les appareils. Les six restaurants, produits, prix, avis et délais sont fictifs ; les photographies sont illustratives. Le paiement est simulé par défaut. Une intégration **Stripe exclusivement en mode test** est préparée et reste désactivée sans configuration ; aucun encaissement réel ni déplacement n’est activé. Voir [les paiements et leurs limites](docs/PAIEMENTS.md).

## Quatre comptes pour tester

Mot de passe commun : **`ManjeoDemo2026!`**

| Rôle | Adresse de connexion | Accès |
| --- | --- | --- |
| Client | `client@manjeo.test` | Catalogue, coordonnées et adresse habituelle, panier, commandes en cours et historique |
| Restaurateur | `restaurant@manjeo.test` | Commandes, carte et réglages de **Ti Kaz Kréol** |
| Livreur | `livreur@manjeo.test` | Disponibilité, offres, retrait et remise avec code client |
| Administrateur | `admin@manjeo.test` | Commandes, cartes, comptes et affectation des livreurs |

Chaque compte ouvre exclusivement son espace : [client](https://manjeo.vercel.app/),
[restaurateur](https://manjeo.vercel.app/restaurant), [livreur](https://manjeo.vercel.app/livreur)
ou [administration](https://manjeo.vercel.app/admin). Les espaces professionnels ne proposent
ni vitrine, ni panier, ni achat. Leur marque ne renvoie pas au catalogue. Une ancienne URL,
un rechargement ou l’historique du navigateur ramène au rôle de la session vérifiée par le serveur.
L’admin conserve la gestion des restaurants et des cartes dans son panneau de supervision.

Sans connexion, les adresses professionnelles affichent leur formulaire de connexion ; après
déconnexion, elles restent sur ce formulaire. Le catalogue reste accessible aux visiteurs depuis
la racine. Pour commander, utiliser un compte client distinct. La langue, les coordonnées du
compte et la déconnexion restent disponibles dans chaque espace.

Ces comptes de démonstration sont partagés entre les testeurs : utiliser un nom et un téléphone fictifs, et un point d’adresse de démonstration, sans l’associer à une personne réelle. Le rôle est vérifié côté serveur. Les mots de passe sont hachés ; les sessions utilisent des cookies HttpOnly et Secure en ligne.

## Passer une commande de bout en bout

1. Ouvrir le site et se connecter avec le compte client. Choisir **Ti Kaz Kréol** et ajouter un poulet boucané au panier.
2. Renseigner un nom et un téléphone fictifs. Rechercher par exemple **7 Rue Lallouette, Cayenne**, vérifier le point proposé sur la carte et le confirmer. Choisir **Simulation sans paiement**, puis confirmer la commande. Les coordonnées peuvent être enregistrées pour les prochaines fois ; conserver le numéro de commande.
3. Se connecter au compte restaurateur. Accepter la commande, démarrer la préparation et la marquer **Prête au retrait**.
4. Se connecter au compte livreur, activer sa disponibilité et prendre cette course. Le retrait est possible lorsque le restaurant l’a marquée prête.
5. Après le retrait, ouvrir le suivi côté client pour lire son code à quatre chiffres. Dans l’espace livreur, saisir ce code pour confirmer la remise fictive. Le restaurant et le livreur ne peuvent pas lire le code dans l’API.
6. L’admin retrouve la commande, son livreur et les événements. Il peut affecter ou réaffecter une course avant son retrait avec un motif ; il ne peut pas valider une livraison à la place du livreur.

Le compte restaurateur fourni gère uniquement Ti Kaz Kréol. Choisir cette enseigne pour tester le traitement complet. Le catalogue comprend aussi Smash Club, Bowl Tropical, Ciao Cayenne, Crispy Kaz et La Marée Cayennaise. Les commandes confirmées sont visibles depuis un autre appareil avec le même compte.

Avec un nom, un téléphone et une adresse confirmée enregistrés, le panier présente un récapitulatif et un bouton **Confirmer** : la commande suivante se fait directement depuis le panier. Le client peut ouvrir le formulaire pour modifier les coordonnées ou le paiement. Une commande en cours reste accessible dans son suivi. Le parcours Stripe, lorsqu’il est configuré, ouvre sa page hébergée et attend son webhook signé avant de transmettre la commande au restaurant ; le simple retour du navigateur ne confirme pas le paiement.

Un livreur ne peut avoir qu’une course active. Les offres affichent le restaurant et la commune de destination ; les coordonnées de livraison deviennent visibles après affectation. Il peut libérer une course avant le retrait avec un motif. Le client peut annuler une commande encore en attente ; le restaurant ou l’admin peuvent l’annuler avant le retrait. Une livraison terminée ne peut pas être modifiée.

## Direction visuelle

L’interface suit la direction « Punch » : fond crème, un seul jaune en aplat, encre noire pour tout le
texte, titres Archivo Black en capitales sur Figtree, bordures de 2 px et pastilles. Les jetons sont
déclarés une seule fois dans `:root` au début de `app/globals.css` ; aucun composant ne doit coder une
couleur en dur. Les règles complètes, la typographie, les états et les écarts assumés par rapport au
handoff sont dans [la direction « Punch »](docs/DIRECTION-PUNCH.md).

## Délais, codes promo et adresses

- **Le restaurant a dix minutes pour accepter.** Après l’échéance, le serveur refuse l’acceptation. L’annulation et la restitution du code promo sont enregistrées lors de la prochaine requête concernant les commandes, livraisons, livreurs ou promotions, y compris si l’action demandée est refusée. Le client et le restaurant voient le compte à rebours. Aucune tâche de fond n’est configurée sur le déploiement Vercel Hobby : sans requête, la base peut encore afficher l’ancien statut jusqu’à la consultation suivante.
- **Une estimation apparaît à l’acceptation** (préparation annoncée + quinze minutes de course). Elle est affichée au client, au restaurateur et au livreur, et le retard est signalé aux trois.
- **Trois codes de démonstration** : `BIENVENUE` (20 % dès 15 €, une fois par compte), `LIVRAISON` (livraison offerte dès 25 €) et `TIKAZ5` (5 € chez Ti Kaz Kréol dès 20 €). Le code se saisit dans le panier ; la remise est revérifiée si le compte, le restaurant, la commune ou les montants changent. Le serveur la recalcule à la confirmation et refuse tout total qui ne correspond pas. Un code est rendu quand la commande est annulée.
- **Un client ne peut pas cumuler plus de cinq commandes en cours**, pour que la démonstration partagée reste lisible.
- **La saisie reste libre, puis le point doit être confirmé avant une nouvelle commande.** L’autocomplétion interroge l’IGN/BAN en ligne ; son secours fixe est annoncé comme démonstration. La vérification distincte exige un vrai résultat IGN dans l’une des trois communes et ne transforme jamais ce secours en preuve. Le client choisit le résultat et vérifie l’entrée ; un résultat limité à la rue demande des précisions. Une panne permet de corriger la saisie et de réessayer, sans autoriser une commande non vérifiée. [Service de géocodage IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/).
- **L’adresse habituelle confirmée reste valable trente jours**, avec adresse, commune, précisions et point géographique. Modifier le nom, le téléphone ou les précisions ne prolonge pas cette validité. Changer la rue ou la commune exige une nouvelle vérification. La base ne publie pas l’adresse habituelle dans la liste des comptes ; la commande conserve son propre instantané.
- **Google Maps, Waze et Plans (Apple) ouvrent un itinéraire choisi par le livreur.** Le point provient de l’IGN, pas d’une validation postale Google. Google Address Validation ne liste pas la Guyane (`GF`) dans sa couverture ; Waze fournit des liens de navigation. Les commandes historiques sans point conservent leur adresse texte et restent consultables. [Couverture officielle Google](https://developers.google.com/maps/documentation/address-validation/coverage), [liens Waze](https://developers.google.com/waze/deeplinks).

## Modifier la carte

Dans l’espace restaurateur, ouvrir **Ma carte** : créer, renommer et réordonner des catégories ; ajouter ou modifier un produit, sa description, son prix, sa photo, ses allergènes, sa disponibilité et ses groupes d’options. Chaque groupe définit un minimum, un maximum et les suppléments de prix de ses choix. Les produits peuvent être archivés puis restaurés. Les photos JPEG, PNG ou WebP sont enregistrées dans la base après validation et réencodage (1 Mo maximum à l’envoi).

Les modifications restent un brouillon jusqu’à **Publier la carte**. Si un autre onglet publie entre-temps, un conflit empêche l’écrasement et permet de conserver le brouillon pour le comparer à la nouvelle carte. L’admin dispose du même éditeur pour tous les restaurants.

Une modification ne change jamais le prix ni les options d’une commande déjà confirmée. Un panier contenant un produit modifié demande une actualisation explicite avant de commander ; les produits retirés ou options supprimées doivent être revus. Le serveur vérifie la version, les options, le prix unitaire et le total, puis calcule les montants en centimes. La livraison fictive ajoute 1 € hors Cayenne.

Le restaurant peut aussi modifier sa présentation, son adresse de retrait, son délai et l’ouverture des commandes. Les règles détaillées et les références utilisées sont dans [le contrat des quatre espaces](docs/FOUR-ROLES-CONTRACT.md).

## Coordonnées, messagerie et langues

Chaque compte porte un nom et un téléphone, modifiables depuis **Mon compte**. Le client y enregistre
également son adresse habituelle confirmée, les précisions et sa préférence de paiement : simulation
ou Stripe de test. La préférence ne contient aucun numéro de carte. La langue vient du menu global
FR/HT/PT. Ces coordonnées préremplissent les prochaines commandes, tandis que les instantanés des
commandes déjà confirmées restent inchangés.

Les champs que vous ne modifiez pas suivent les données fraîches du compte. Une sauvegarde ne
transmet que vos modifications : changer le téléphone ne réenregistre pas une ancienne adresse.
Si la confirmation d’une commande est interrompue par le réseau, un récapitulatif **Confirmation à
reprendre** permet de reprendre la demande exacte après rechargement. Cette reprise conserve son
identifiant, son destinataire et ses instructions, et bloque une nouvelle confirmation tant que le
résultat reste incertain. Une commande confirmée est consultable dans **Commandes en cours**.

- **Les numéros suivent la prise en charge.** Le client joint le restaurant de l’acceptation à la
  livraison, et son livreur dès que la commande est prête puis pendant la livraison. Le livreur
  affecté joint le client et le restaurant ; le restaurant joint le client et le livreur affecté.
  Les numéros de ces contacts sont retirés dès la livraison ou l’annulation. L’admin les conserve
  pour l’assistance ; le client garde les coordonnées de sa propre commande.
- **Une conversation est attachée à chaque commande.** L’écriture s’ouvre à l’acceptation et reste
  possible trente minutes après la livraison ou une annulation ultérieure. Une commande annulée
  avant acceptation n’ouvre pas de conversation. L’historique reste ensuite lisible par le client,
  le restaurant, le livreur encore affecté et l’administration. Un livreur réaffecté ou ayant libéré
  la course perd cet accès. Les non-lus sont suivis par compte et une nouvelle tentative d’envoi
  conserve le même identifiant pour éviter les doublons. Les échanges sont actualisés périodiquement.
- **Les réponses rapides ont des versions préparées** en français, créole haïtien, créole guyanais,
  portugais, anglais, espagnol et chinois dans le répertoire historique ; l’interface utilise le choix
  global FR/HT/PT. Elles sont identifiées comme telles et ne nécessitent
  pas de moteur de traduction après chargement du répertoire. Elles ne constituent pas une garantie
  de justesse ou de fonctionnement hors ligne de l’application.
- **Les messages libres reçus sont soumis automatiquement au moteur serveur**, dans la langue
  choisie par le lecteur. Le serveur contrôle l’accès à la commande et charge le message depuis
  son identifiant. Le moteur détecte sa langue réelle : un profil français peut écrire en portugais.
  Une traduction réussie est conservée en cache ; les originaux restent accessibles. Le chat
  n’utilise pas Chrome Translator et ne télécharge pas de modèle dans le navigateur. Une panne
  ou un quota atteint laisse l’original visible et permet de réessayer.
- **Le branchement Vercel AI Gateway est prêt mais son activation reste bloquée.** Les essais
  fictifs du 12 septembre 2026 ont reçu `403 customer_verification_required` : Vercel demande
  à l’administrateur d’enregistrer une carte pour débloquer ses crédits gratuits. Aucun achat
  n’a été effectué, la consommation reste nulle et aucune traduction libre réelle n’a encore
  été qualifiée. Voir [la configuration, le lien d’activation et le corpus à vérifier](docs/TRADUCTION.md).

Les traductions de l’interface et des réponses rapides doivent être relues par des locuteurs compétents,
ainsi que le corpus des traductions automatiques après activation, avant une mise en service réelle.

## Données et déploiement

La base Neon dédiée au projet utilise le schéma PostgreSQL `manjeo`. Les quatre comptes et le catalogue initial sont créés à l’initialisation. Les migrations ajoutent le rôle livreur et les nouveaux champs aux bases existantes sans remplacer les cartes modifiées, comptes, sessions ou commandes. Les commandes sont conservées entre les déploiements Vercel. Les prévisualisations utilisent le schéma distinct `manjeo_preview` (`MANJEO_DB_SCHEMA` dans l’environnement Preview), pour séparer leurs essais de la démonstration principale.

La branche **`main`** du dépôt [is4acs/manjeo](https://github.com/is4acs/manjeo/tree/main) déclenche les déploiements Production de Vercel. Les branches `codex/…`, dont `codex/four-roles-menu-delivery`, servent au travail et aux déploiements Preview. Tester la Preview, puis intégrer les changements validés dans `main` et pousser cette branche pour publier sur `manjeo.vercel.app`. Vérifier le résultat du déploiement avant de tester la nouvelle version en Production.

Configuration serveur dans les variables d’environnement Vercel :

- `DATABASE_URL` : connexion PostgreSQL fournie par Neon ; `POSTGRES_URL` est accepté comme alternative.
- `APP_ORIGIN` : `https://manjeo.vercel.app` pour l’environnement Production.
- `MANJEO_DB_SCHEMA` : schéma isolé selon l’environnement, notamment `manjeo_preview` pour les essais Preview.
- `MANJEO_ADDRESS_PROVIDER=ign` active aussi l’autocomplétion distante en local. La vérification obligatoire utilise toujours le service IGN réel, sans clé. `MANJEO_ADDRESS_REQUESTS_PER_MINUTE` et `MANJEO_ADDRESS_REQUESTS_PER_DAY` bornent les demandes (10/minute/compte et 200/jour UTC/schéma par défaut).
- `MANJEO_PAYMENT_MODE=demo` par défaut ; `stripe_test` exige les secrets serveur **de test** décrits dans [PAIEMENTS.md](docs/PAIEMENTS.md). Une préférence Stripe sauvegardée ne suffit pas à activer ce service.
- `MANJEO_TRANSLATE_PROVIDER` : `auto` par défaut, ou `vercel` pour AI Gateway avec OIDC côté serveur. `MANJEO_TRANSLATE_MODEL` choisit le modèle (`openai/gpt-4.1-mini` par défaut). L’équipe doit d’abord activer son accès ; les identifiants ne vont jamais dans le navigateur.
- `MANJEO_TRANSLATE_URL` et `MANJEO_TRANSLATE_KEY` : relais LibreTranslate compatible facultatif, actuellement non configuré. Les quotas serveur, les conditions du palier gratuit et le contrat d’autodétection sont détaillés dans [le guide traduction](docs/TRADUCTION.md).

La connexion à la base reste côté serveur : ne pas la préfixer avec `VITE_`, l’ajouter au code ou la publier dans Git. Sur Vercel, une connexion de base manquante provoque une erreur explicite ; l’API ne crée pas de base SQLite temporaire à la place.

Vercel compile l’interface avec `npm run build:vercel` et sert l’API via `api/index.py`. Le runtime Python est fixé à 3.12 et les dépendances Python sont déclarées dans `requirements.txt`.

Les anciens essais SQLite de l’ordinateur ne sont pas importés dans Neon. La migration de cet historique n’est pas implémentée. Le panier reste propre au navigateur ; l’adresse habituelle enregistrée, la préférence de paiement, les commandes confirmées et leur suivi sont partagés via la base en ligne.

## Codex Cloud et reprise sur MacBook

Le dépôt inclut `AGENTS.md` pour transmettre le contexte à un nouvel agent, `scripts/codex-setup.sh` pour installer les dépendances, et `scripts/codex-check.sh` pour exécuter les tests autonomes et compiler. La connexion GitHub et l’environnement Cloud se configurent dans Codex Web ; suivre le [guide Cloud et MacBook](docs/REPRENDRE-SUR-MACBOOK.md#activer-codex-cloud).

## Modifier et vérifier le code

Le [rapport d’audit du 12 septembre 2026](docs/AUDIT-2026-09-12-PARCOURS.md) décrit les corrections des parcours, les essais isolés et les limites des validations.

Prérequis : Git, Node.js 22.13 ou supérieur avec npm, et Python 3.12 pour le backend et le traitement des photos. Cloner le dépôt dans un dossier hors iCloud et ouvrir ce dossier dans Codex ; voir le [guide MacBook](docs/REPRENDRE-SUR-MACBOOK.md).

```sh
bash scripts/codex-setup.sh
bash scripts/codex-check.sh
```

Le setup installe les dépendances verrouillées dans `.venv` et `node_modules`. Le script de vérification utilise le Python du venv et retire les connexions de base de son environnement : il exécute les tests autonomes, TypeScript puis Vite. Les tests couvrent notamment le panier, les promotions, les adresses, les permissions, les cartes, les migrations, les affectations, le code de remise, la messagerie et la traduction. Les tests de traduction simulent le fournisseur : ils vérifient les accès, le cache, les quotas et les erreurs, sans coût ni certification linguistique. Les tests SQLite utilisent des bases temporaires. Les tests PostgreSQL sont ignorés par ce script ; signaler cette limite avec les résultats.

Pour les tests d’intégration PostgreSQL, fournir séparément `MANJEO_TEST_DATABASE_URL` vers une base dédiée, puis lancer la suite correspondante. Elle crée ses propres schémas temporaires. Ne pas utiliser la base du site public.

```sh
env -u DATABASE_URL -u POSTGRES_URL -u VERCEL .venv/bin/python -m unittest discover -s server -p 'test_*.py'
```

### Parcours navigateur sur une base jetable

La suite Playwright versionnée complète les tests unitaires. Après le setup :

```sh
npx playwright install chromium
npm run test:browser
```

Pour vérifier également les moteurs de Safari et Firefox :

```sh
npx playwright install webkit firefox
MANJEO_TEST_BROWSERS=chromium,webkit,firefox npm run test:browser
```

La commande compile l’interface et démarre son propre serveur sur un port localhost libre, avec
une base SQLite temporaire supprimée à l’arrêt. Elle n’accepte aucune URL de déploiement et ignore
les connexions de base et secrets du shell. Le géocodeur externe est remplacé par un point de test ;
les sessions, preuves d’adresse, profils, prix, commandes, rôles, affectations et codes de remise
passent par la véritable API. Les paiements restent simulés. Ces tests ne qualifient donc ni l’IGN
en ligne, ni Stripe, ni la traduction externe. Ils vérifient notamment la commande en un clic,
la reprise après réponse perdue, les profils modifiés depuis deux appareils, les langues persistantes,
les fenêtres mobiles et les erreurs de chargement. Ils se lancent séparément de `codex-check.sh`.

## Option : développement local avec SQLite

Le mode local permet des essais indépendants de la démonstration en ligne. Sans variable `DATABASE_URL` ni `POSTGRES_URL`, le serveur local utilise `.data/manjeo.sqlite3`, exclue de Git. Utiliser aussi l’environnement Python 3.12 et les dépendances ci-dessus pour disposer du traitement des photos.

```sh
source .venv/bin/activate
npm run build
npm start
```

Ouvrir [http://127.0.0.1:5173/](http://127.0.0.1:5173/). La commande de build locale utilise un cache hors des dossiers synchronisés pour éviter les blocages iCloud. Garder le terminal ouvert pendant l’utilisation locale ; `Ctrl-C` arrête le serveur.

Pour le rechargement automatique, utiliser `npm run dev` avec le venv activé après le setup. Cette commande lance Vite sur 5173 et l’API Python sur 5174 ; les requêtes `/api` passent par Vite. Arrêter l’autre lanceur local avant de changer de mode, car ils utilisent le même port.

Une base SQLite séparée peut être choisie avec `MANJEO_DB=/chemin/vers/test.sqlite3 npm start`. Les modifications de cette base locale n’affectent pas Neon. Pour recommencer une démo locale, arrêter les serveurs et déplacer `.data` vers une sauvegarde avant de relancer ; conserver les sauvegardes hors de Git.

## Repères dans le dépôt

- `app/` : interfaces React et TypeScript.
- `lib/` : catalogue initial et client API.
- `server/` : API, sessions, contrôles de rôle, persistance et tests.
- `api/index.py` : point d’entrée Python pour Vercel.
- `vercel.json` : compilation et routage du déploiement.
- `scripts/` : lanceurs et compilation pour le travail local.
- `public/images/` : images locales ; sources et licences dans `ASSET-SOURCES.md`.

Cette application est une démonstration publiée en ligne. Sa messagerie interne est partagée entre les comptes de test ; elle ne déclenche aucun SMS, appel automatique, paiement ou déplacement réel.
