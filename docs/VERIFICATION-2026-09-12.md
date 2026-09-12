# Réparation des parcours du 12 septembre 2026

La branche `codex/repair-business-flows` intègre la version publiée par Claude (`c17d542`) et les scripts Cloud de `main`. La direction visuelle Punch est conservée. Les changements ciblent les parcours partagés entre client, restaurant, livreur et admin.

## Défauts corrigés

- Appliquer un code promo ne soumet plus le formulaire de commande. L’aperçu de remise dépend du compte, du restaurant, de la destination et des montants courants ; les réponses dépassées sont ignorées.
- Les suggestions d’adresse fonctionnent dans les trois entrées avec sélection explicite au clavier ou à la souris. L’IGN/BAN est interrogé en ligne, avec secours démo indiqué. Fermer le message « aucune suggestion » ne déplace plus le bouton de confirmation sous le clic.
- L’expiration d’une commande et la restitution de sa promotion restent enregistrées même si l’action demandée échoue. L’acceptation est aussi refusée si l’échéance est franchie pendant le traitement. Les erreurs de délai PostgreSQL restent des erreurs temporaires 503.
- Les quotas, montants, rôles, étapes de livraison, versions de carte et identifiants de nouvelle tentative sont contrôlés par le serveur, y compris en concurrence.
- Les téléphones, conversations et non-lus suivent le compte et l’affectation de la course. Les coordonnées client viennent de la commande confirmée ; les messages utilisent des récépissés individuels et des identifiants de nouvelle tentative.
- L’admin peut participer à l’assistance. Le livreur retrouve la conversation dans son historique pendant la fenêtre après livraison. Les réponses rapides préparées sont distinguées de la traduction automatique du texte libre.
- Les anciennes réponses de session ou de profil ne doivent pas déconnecter un nouveau compte ni écraser une saisie. Les accès professionnels du pied de page proposent le rôle demandé.

## Vérifications

Les tests Python couvrent SQLite et un PostgreSQL 16.15 local dédié, avec schémas temporaires. Aucun test de régression n’utilise la base du site public. Python 3.12 et Node 22.22 ont été utilisés. Le passage complet valide **163 tests Python** et **27 tests client**, sans test ignoré. TypeScript et le build Vite passent. La commande du passage complet est :

```sh
env PATH="$PWD/.venv/bin:$PATH" MANJEO_TEST_DATABASE_URL='<base PostgreSQL de test dédiée>' npm test
npm run build:vercel
```

Parcours navigateur exécutés sur une base PostgreSQL isolée :

1. Connexion client, adresse choisie au clavier, deux poulets à 22 €, code BIENVENUE, changement de commune vers Matoury, confirmation en un clic à 21,10 €.
2. Acceptation restaurant ; prise de course par le livreur ; retrait refusé tant que la cuisine n’a pas marqué la commande prête.
3. Préparation, commande prête, retrait, réponse rapide portugaise affichée en créole haïtien, message d’assistance admin reçu par le client.
4. Livraison avec le code du client, statut persistant, téléphone retiré et conversation encore accessible depuis l’historique du livreur.
5. Publication d’un nouveau prix restaurant, détection du panier périmé et actualisation explicite côté client ; création puis archivage d’un produit ; prix et articles des commandes confirmées préservés.

Les dialogues de compte, les anciens 401, la panne de relecture de session et le changement de rôle depuis le pied de page ont également été vérifiés. À 320, 390 et 430 px, les boutons de l’en-tête restent accessibles et la page ne déborde plus horizontalement.

Le parcours complet des quatre comptes a ensuite réussi sur la [Preview Vercel de validation](https://manjeo-1m64v6rbe-is4acs-projects.vercel.app), construite depuis `7a27b8a`, avec un schéma PostgreSQL dédié (`manjeo_repair_20260912`). L’API d’adresses de cette Preview a renvoyé `source: "ign"`. La branche de réparation dispose de son propre réglage de schéma Preview ; ce réglage ne s’applique pas à la Production.

## Limites connues

La démonstration n’effectue ni paiement ni livraison réelle. Aucun moteur serveur de traduction n’est configuré : les textes libres portugais/créole haïtien restent dans leur langue d’origine, avec indication explicite, jusqu’à la connexion d’un service compatible. Les formulations rapides préparées nécessitent une relecture linguistique avant une exploitation réelle.

Le délai de dix minutes est contrôlé par le serveur. Sans tâche de fond configurée sur Vercel Hobby, l’annulation est enregistrée à la prochaine requête métier ; une commande dépassée ne peut plus être acceptée.
