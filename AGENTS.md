# Manjéo

Démonstration de commande de repas en Guyane : React/TypeScript/Vite, API Python, PostgreSQL sur Vercel/Neon et SQLite pour les essais isolés. Les paiements et livraisons sont fictifs. Le site de référence est https://manjeo.vercel.app.

## Reprendre le projet

- Lire `README.md`, `docs/FOUR-ROLES-CONTRACT.md` et `docs/REPRENDRE-SUR-MACBOOK.md`.
- `app/` contient les espaces client, restaurateur, livreur et admin ; `lib/` les types, le panier et le catalogue initial ; `server/` l’API, les migrations et les tests.
- `api/index.py` et `vercel.json` définissent l’entrée et le routage Vercel. Le répartiteur Python s’appelle `dispatch_api` : ne pas le renommer `handle_request`, réservé au runtime Vercel.

## Installation et vérification

Utiliser Node >=22.13 et Python 3.12. À la racine du dépôt :

```sh
bash scripts/codex-setup.sh
bash scripts/codex-check.sh
```

Le setup crée `.venv` et installe les dépendances verrouillées. Le même script peut servir à la maintenance d’un cache Cloud. Le script de vérification choisit explicitement le Python du venv, exécute les tests puis TypeScript et Vite.

Sans connexion PostgreSQL de test, 34 tests Python et 7 tests panier s’exécutent ; les 30 tests PostgreSQL sont ignorés. Signaler les tests ignorés. Les tests PostgreSQL supplémentaires nécessitent une base dédiée fournie par `MANJEO_TEST_DATABASE_URL` et créent leurs propres schémas temporaires ; ne pas utiliser la base du site public.

## Invariants

- Vérifier les rôles, les prix et les transitions côté serveur.
- Conserver l’idempotence des commandes, les versions des cartes et les instantanés des commandes confirmées.
- Une seule course active par livreur ; affectation et transitions atomiques.
- Le code de remise est visible uniquement par le client propriétaire et l’admin. Les offres non affectées ne révèlent pas les coordonnées du client.
- Préserver les cartes modifiées, les comptes, les sessions et les commandes lors des migrations et redémarrages.
- Ne pas committer de secrets, `.env*`, données locales, sessions, dépendances ou fichiers générés. Ne jamais mettre de connexion de base dans une variable `VITE_`.

## Git et déploiement

Vérifier l’état Git et préserver le travail existant avant de récupérer des changements. Travailler sur une branche `codex/…`. La branche `main` déclenche la Production Vercel ; les branches de travail déclenchent des Preview. Suivre les autorisations de la tâche pour publier et vérifier le déploiement. Rapporter les modifications, les vérifications et leurs limites.

Sur un Mac, placer les nouveaux clones dans `~/Developer/manjeo`, hors iCloud. L’ancien dossier Documents a déjà subi des interruptions de lecture et d’écriture liées à iCloud.
