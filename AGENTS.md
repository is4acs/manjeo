# Manjéo

Démonstration de commande de repas en Guyane : React/TypeScript/Vite, API Python, PostgreSQL sur Vercel/Neon et SQLite pour les essais isolés. Les paiements et livraisons sont fictifs. Le site de référence est https://manjeo.vercel.app.

## Reprendre le projet

- Lire `README.md`, `docs/FOUR-ROLES-CONTRACT.md` et `docs/REPRENDRE-SUR-MACBOOK.md`.
- Pour les paiements, lire `docs/PAIEMENTS.md` : Stripe est exclusivement de test et reste indisponible sans configuration serveur ; aucun encaissement réel.
- `app/` contient les espaces client, restaurateur, livreur et admin ; `lib/` les types, le panier et le catalogue initial ; `server/` l’API, les migrations et les tests.
- `api/index.py` et `vercel.json` définissent l’entrée et le routage Vercel. Le répartiteur Python s’appelle `dispatch_api` : ne pas le renommer `handle_request`, réservé au runtime Vercel.

## Installation et vérification

Utiliser Node >=22.13 et Python 3.12. À la racine du dépôt :

```sh
bash scripts/codex-setup.sh
bash scripts/codex-check.sh
```

Le setup crée `.venv` et installe les dépendances verrouillées. Le même script peut servir à la maintenance d’un cache Cloud. Le script de vérification choisit explicitement le Python du venv, exécute les tests puis TypeScript et Vite.

Le script de vérification retire les connexions de base de son environnement : il lance les tests autonomes et ignore les tests PostgreSQL. Signaler les tests ignorés, sans maintenir ici de totaux fixes. Les tests PostgreSQL supplémentaires se lancent séparément avec `.venv/bin/python -m unittest discover -s server -p 'test_*.py'` et une base dédiée fournie par `MANJEO_TEST_DATABASE_URL` ; ils créent leurs propres schémas temporaires. Ne pas utiliser la base du site public.

## Invariants

- Vérifier les rôles, les prix et les transitions côté serveur.
- Conserver l’idempotence des commandes, les versions des cartes et les instantanés des commandes confirmées.
- Une nouvelle commande exige une preuve d’adresse liée au client ou son adresse habituelle encore valable. Le replay précède cette validation ; conserver le corps exact d’une requête incertaine même si sa preuve devient une adresse enregistrée.
- L’adresse habituelle et la préférence de paiement sont privées au compte. Le point d’une commande est visible seulement par son client, l’admin et le livreur affecté ; ni restaurant ni offre libre. Une modification du profil ne change pas l’instantané.
- Une acceptation après dix minutes doit être refusée. L’expiration et la restitution d’une promotion doivent rester validées même si l’action demandée est refusée ; préserver le point de sauvegarde de `dispatch_api`.
- Une seule course active par livreur ; affectation et transitions atomiques.
- Le code de remise est visible uniquement par le client propriétaire et l’admin. Les offres non affectées ne révèlent pas les coordonnées du client.
- Les droits de conversation suivent l’affectation courante. Préserver les récépissés par message et compte, l’idempotence des envois et les fenêtres de téléphone définies dans le contrat.
- Ne pas écraser les brouillons de profil, d’adresse, de panier ou de carte avec une réponse tardive. Un ancien 401 doit confirmer la session courante avant de déconnecter.
- Préserver les cartes modifiées, les comptes, les sessions et les commandes lors des migrations et redémarrages.
- Ne pas committer de secrets, `.env*`, données locales, sessions, dépendances ou fichiers générés. Ne jamais mettre de connexion de base dans une variable `VITE_`.

## Fonctionnement et limites à préserver

- Garder la direction visuelle « Punch » et les jetons de `app/globals.css` ; lire `docs/DIRECTION-PUNCH.md` avant de modifier les interfaces.
- Les suggestions viennent de l’IGN/BAN, avec secours fixe annoncé comme démonstration (par défaut pour l’autocomplétion locale). La vérification obligatoire de commande est distincte et utilise toujours un vrai géocode IGN. Un résultat proposé donne un token de quinze minutes ; l’adresse confirmée sauvegardée est réutilisable trente jours. Jamais de preuve tirée de la liste fixe ni de promesse de validation postale Google. Google Maps, Waze et Plans sont des liens de navigation.
- Aucune tâche de fond n’est configurée sur le déploiement Vercel Hobby. L’expiration des commandes est enregistrée lors d’une requête liée aux commandes, livraisons, livreurs ou promotions ; ne pas promettre une mise à jour de la base sans requête.
- La conversation s’écrit après acceptation et pendant trente minutes après livraison ou annulation ultérieure ; elle reste ensuite consultable aux comptes autorisés. Une annulation avant acceptation n’ouvre pas le fil.
- Le choix global FR/HT/PT pilote l’interface et les messages ; aucun sélecteur distinct de sept langues. Le serveur conserve la compatibilité de lecture des anciens messages et profils.
- Distinguer les réponses rapides préparées de la traduction du texte libre. Le chat utilise les identifiants de commande/message, contrôle les droits et demande au moteur serveur de détecter la langue réelle ; aucun téléchargement de modèle navigateur. AI Gateway reste bloqué par l’activation du compte documentée dans `docs/TRADUCTION.md`. Conserver les originaux ; la qualité linguistique n’est pas qualifiée tant que le moteur réel n’a pas été testé.
- Une commande Stripe reste `awaiting_payment` avant son webhook signé de test, sans accès cuisine/livreur. Le retour navigateur ne prouve pas le paiement. Une annulation payée reste à rembourser tant que le webhook de remboursement n’a pas confirmé la suite.

## Git et déploiement

Vérifier l’état Git et préserver le travail existant avant de récupérer des changements. Travailler sur une branche `codex/…`. La branche `main` déclenche la Production Vercel ; les branches de travail déclenchent des Preview. Suivre les autorisations de la tâche pour publier et vérifier le déploiement. Rapporter les modifications, les vérifications et leurs limites.

Sur un Mac, placer les nouveaux clones dans `~/Developer/manjeo`, hors iCloud. L’ancien dossier Documents a déjà subi des interruptions de lecture et d’écriture liées à iCloud.
