# manjéo — MVP client local

Interface de commande de repas pour Cayenne, Rémire-Montjoly et Matoury.
Tous les restaurants, menus, prix, avis et délais sont fictifs. Les photographies sont illustratives.

## Tester

```sh
npm install
npm run dev
```

Ouvrir http://localhost:5173.

- Rechercher un restaurant ou un plat, filtrer par cuisine et trier les adresses.
- Ouvrir un menu et ajouter un plat ; les plats créoles et de la mer proposent une grande portion (+2 €) et un choix de piment.
- Modifier les quantités, retirer un article et confirmer le remplacement du panier en changeant de restaurant.
- Choisir la commune (supplément fictif de 1 € hors Cayenne), renseigner les coordonnées et valider une commande test.
- Consulter les dix dernières commandes locales.

Le panier et la destination sont conservés dans localStorage. L’historique ne stocke ni nom ni téléphone. Il n’existe aucun compte, paiement, envoi au restaurant ou suivi de livraison réel. Effacer les données du site réinitialise la démonstration.

## Développement

React, TypeScript, Vite et composants Radix. Le catalogue se trouve dans `lib/menu.ts`, le parcours dans `app/page.tsx` et les styles dans `app/globals.css`. Les prix sont stockés en centimes.

```sh
npx tsc --noEmit
npm run build
```

Les navigateurs compatibles WebMCP peuvent lire les menus (`get_demo_menus`) et ajouter un article classique au panier (`stage_demo_cart_item`). Ces outils ne confirment jamais une commande. Leur disponibilité dépend du navigateur.

Les sources et licences photographiques sont documentées dans `ASSET-SOURCES.md`.

## Vérifications effectuées

Compilation TypeScript et build de production réussis. Parcours vérifié dans le navigateur sur ordinateur et en largeur mobile de 390 px : recherche, filtre cuisine, personnalisation, conservation du panier et de la destination au rechargement, annulation du changement de restaurant, validation du téléphone, confirmation et historique.

Commande test vérifiée : deux poulets boucanés en grande portion (26 €), un jus (3,50 €), livraison à Matoury (3,50 €), total 33 €. Outils WebMCP testés avec lecture du catalogue, ajout valide et refus d’un produit inconnu. Aucun appel de paiement ni envoi externe.
