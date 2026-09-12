# Manjéo — contrat des quatre espaces

Référence d’implémentation de la démonstration, 12 septembre 2026. Les paiements, déplacements et contacts restent fictifs. Production : `https://manjeo.vercel.app`, PostgreSQL Neon. Les données existantes sont conservées.

## Types communs

- Role : `client | restaurant | courier | admin`. Nouveau compte : `livreur@manjeo.test`, mot de passe de démonstration existant, id `demo-courier`, nom `Alex Livraison`.
- OptionChoice : `{id:string, name:string, price:number}` ; prix entier en centimes, supplément positif ou nul.
- OptionGroup : `{id:string, name:string, min:number, max:number, choices:OptionChoice[]}`. Choix multiples possibles, `0 <= min <= max <= choices.length`, max au moins 1.
- Selection : `{groupId:string, choiceIds:string[]}`. Pas de doublons, groupes/choix appartenant au produit ; règles min/max contrôlées serveur.
- Product conserve `id,name,description,price,group,image?,popular?,available`; ajoute `version:number, archived:boolean, allergens:string, optionGroups:OptionGroup[]`. `large` est une donnée historique : migrer ses choix dans optionGroups, ne plus l’utiliser pour calculer de nouvelles commandes.
- Restaurant conserve ses champs ; ajoute `menuVersion:number, categories:string[], pickupAddress:string, pickupCity:string`. `from` est recalculé à partir des produits actifs disponibles. Le catalogue public exclut les produits archivés.
- Order conserve ses champs et instantanés d’articles ; ajoute `courierId:string|null, courierName:string|null, pickupAddress:string, pickupCity:string, deliveryCode?:string`. Statut supplémentaire `picked_up`, libellé « En livraison ». `deliveryCode` n’est fourni qu’au client propriétaire et à l’admin. L’historique accepte `{status,date,label?:string,actorName?:string}`.
- Order ajoute `acceptBy:string|null` (échéance d’acceptation, effacée dès l’acceptation), `eta:string|null` (estimation posée à l’acceptation), `discount:number`, `promoCode:string|null` et `promoLabel:string`. `total = subtotal + delivery - discount`.
- CourierProfile : `{id:string,name:string,email:string,online:boolean,activeOrderId:string|null}`.
- DeliveryOffer : `{id,restaurantId,restaurant,pickupAddress,pickupCity,city,count,status,delivery,date}`. Aucune adresse client, téléphone, nom client, customerId, note ou PIN dans les offres.

## Carte et établissement

- `GET /api/restaurants/:id/menu`, propriétaire/admin : `{menu:{version:number,categories:string[],products:Product[]}}`, inclut archivés.
- `PATCH /api/restaurants/:id/menu`, propriétaire/admin : `{version,categories,products}` -> même réponse. Sauvegarde et publication atomiques, compare la version courante (409 si périmée), valide toute la carte avant toute écriture. Nouveaux ids générés côté client (`crypto.randomUUID()`), uniques et jamais réutilisés pour un autre restaurant. Max 100 produits, 30 catégories, 8 groupes par produit, 20 choix par groupe. Un produit absent du payload est archivé, jamais effacé de l’historique. La UI utilise explicitement archived pour retirer/restaurer. Incrémente la version des produits réellement modifiés, sans écraser les données ou l’ordre aux redémarrages. Noms/descriptions/allergènes bornés, prix 1..100000 centimes. Une catégorie vide reste possible.
- `PATCH /api/restaurants/:id` conserve acceptingOrders et accepte `name,description,minutes,pickupAddress,pickupCity` validés. La livraison conserve ses tarifs actuels. Adresse de retrait obligatoire et fictive pour les démos, ville parmi les trois communes.
- `POST /api/restaurants/:id/images` propriétaire/admin : `{dataUrl}` -> `{url}`. Upload image JPEG/PNG/WebP limité (1 Mo décodé), validation et réencodage Pillow, stockage persistant dédié, URL `/api/images/:id`. Aucun SVG ou fichier arbitraire. `GET /api/images/:id` sert l’image sans cookie nécessaire avec Content-Type/nosniff/cache adaptés. L’éditeur accepte aussi une URL HTTPS ou une image existante `/images/...`; les limites de corps JSON sont adaptées seulement aux endpoints concernés. Pas d’accès réseau serveur pour récupérer une URL utilisateur.

## Commande client

- `POST /api/orders` conserve les coordonnées/idempotence et reçoit `expectedTotal:number` et `items:[{productId,quantity,selections:Selection[],unitPrice:number,productVersion:number}]`.
- Le serveur recalcule tous les prix/suppléments/livraison depuis sa carte et compare prix/version/total attendus ; 409 exige une mise à jour explicite du panier si la carte a évolué. Refus des produits archivés/indisponibles, quantité non entière, options étrangères/absentes/dupliquées. Les instantanés des commandes ne changent jamais quand la carte est modifiée.
- Un replay identique du requestId retourne la commande existante avant les contrôles de carte courante, comme dans le MVP. Un replay différent reste 409.
- `GET /api/orders` : client ses commandes, restaurant ses commandes, admin toutes, courier seulement ses commandes assignées (dont historique terminal), avec projection du PIN selon rôle.

## Délais, promotions et adresses

- **Acceptation sous dix minutes.** À la création, `acceptBy = date + 600 s`. Aucune tâche de fond n’existant sur cet hébergement, l’expiration est constatée paresseusement : toute requête touchant `/api/orders*`, `/api/deliveries` ou `/api/couriers` annule d’abord les commandes `pending` échues, avec un événement d’historique sans `actorName` (« Annulation automatique »), passe l’affectation à `cancelled` et rend le code promo. Une commande expirée ne peut plus être acceptée (409) et disparaît des offres livreur. L’écriture réutilise la transaction en cours (`Handler.ensure_write`), jamais une seconde.
- **Estimation.** `pending→accepted` pose `eta = maintenant + minutes de préparation + 15 min de course` et efface `acceptBy`. Le dépassement n’est pas un statut : les quatre espaces le déduisent de `eta` et le signalent.
- **Plafond client.** Un client ne peut pas dépasser cinq commandes non terminées (409) ; une livraison ou une annulation libère la place.
- `GET /api/promotions` public -> `{promotions:[{code,label,conditions,restaurantId,minimum}]}`, codes actifs, dans leur fenêtre et non épuisés.
- `POST /api/promotions/check` client : `{code,restaurantId,city,subtotal}` -> `{promotion:{code,label,conditions,discount}}`. Aperçu seulement ; le montant qui fait foi est recalculé à la création.
- `POST /api/orders` accepte `promoCode:string|null`. Le serveur revalide le code (actif, fenêtre, restaurant, panier minimum, quota par compte et quota global) et recalcule la remise : `percent` sur le sous-total, `amount` plafonné au sous-total, `delivery` égal aux frais. `expectedTotal` doit inclure la remise, sinon 409. L’usage est enregistré dans `promo_uses` et supprimé à l’annulation, automatique comprise.
- `GET /api/addresses?q=&city=` public -> `{addresses:[{label,number,street,city}]}`, au plus six propositions issues du répertoire fixe de `server/addresses.py` (trois communes). Aucun appel réseau, aucune clé : à remplacer par un géocodeur réel en production, la forme de réponse étant déjà celle attendue par l’interface.

## Livraison et supervision

- `GET /api/deliveries` courier uniquement -> `{available:DeliveryOffer[],assigned:Order[],profile:CourierProfile}`. Offres acceptées/en préparation/prêtes, non assignées, visibles uniquement lorsque le livreur est en ligne et sans mission active. assigned inclut son historique. Coordonnées client accessibles uniquement pour ses missions assignées ; PIN toujours retiré.
- `PATCH /api/courier/profile` courier : `{online:boolean}` -> `{profile}`. Pause autorisée pendant une mission, empêche seulement les nouvelles prises.
- `GET /api/couriers` admin -> `{couriers:CourierProfile[]}`.
- `POST /api/orders/:id/claim` courier : `{}` -> `{order}`. En ligne, une mission active maximum, uniquement commande accepted/preparing/ready non assignée. Claim et capacité atomiques, deuxième livreur 409, replay du même livreur sur la même mission actif retourne 200.
- `POST /api/orders/:id/release` courier propriétaire : `{reason:string}` -> `{ok:true}`. Avant picked_up seulement, raison 3..250 caractères, libère l’affectation et historise.
- `POST /api/orders/:id/assign` admin : `{courierId:string|null,reason:string}` -> `{order}`. Avant picked_up uniquement, courier en ligne et sans autre mission active, contrôle atomique, motif obligatoire (3..250). Null libère ; changement historisé, ancienne mission disparaît du livreur précédent.
- `PATCH /api/orders/:id` : `{status,reason?,deliveryCode?}` -> `{order}`. Restaurant propriétaire et admin : pending→accepted→preparing→ready. Le restaurant ne peut plus simuler la livraison. Courier assigné : ready→picked_up puis picked_up→delivered avec PIN client exact à 4 chiffres. Admin ne contourne pas le PIN en se faisant livreur. PIN mauvais : 400, 5 échecs en 5 minutes entraînent 429, compteur persistant ; ne pas annuler la transaction qui enregistre l’échec. Client peut annuler pending ; restaurant/admin peuvent annuler avant picked_up, motif obligatoire pour tous (3..250). Historique et capacité mis à jour atomiquement ; aucun saut ou retour de statut. Livrée/annulée terminales.
- Une affectation reste attachée à une commande annulée pour l’historique, mais ne consomme plus la capacité. Les commandes v1 déjà livrées restent consultables sans affectation inventée.

## Interfaces et validation

- Restaurant : échéance d’acceptation et retard affichés sur chaque commande, remise visible dans le récapitulatif, commandes/carte, éditeur produits et catégories, groupes/options/prix/photos/allergènes, archivage/restauration, publication explicite, adresse/temps de préparation, livreur identifié quand assigné.
- Livreur : heure de livraison attendue et retard sur la mission, disponibilité, offres, mission courante, collecte conditionnée au statut prêt, livraison avec code demandé au client, libération motivée avant retrait, historique.
- Admin : vue globale et filtres, quatre types de comptes, état et capacité livreurs, assignation/réassignation/libération motivées, carte des restaurants, annulations motivées.
- Client : saisie d’adresse assistée (clavier et lecteur d’écran), code promo vérifié avant commande et revalidé quand le panier change, compte à rebours d’acceptation, estimation de livraison, options dynamiques, panier détectant la carte périmée, mise à jour explicite, suivi cuisine/retrait/livraison, livreur et code de remise visibles, annulation avant acceptation.
- Contrôles serveur systématiques, migrations non destructives SQLite/PG, double attribution impossible, sessions isolées, PIN et données d’offres filtrés, conflits visibles sans perdre le brouillon. Prévisualisation et tests dans des schémas isolés avant publication main.

## Références de parcours

Choix adaptés au MVP, pas une intégration à ces plateformes : [Uber Eats — édition des produits et personnalisations](https://help.uber.com/en/merchants-and-restaurants/article/editing-your-uber-eats-menu?nodeId=49fa4c19-7c4f-408f-97a3-42dbdc56ffbe), [Deliveroo — catégories et publication](https://help.deliveroo.com/fr/articles/6060280-ajouter-modifier-et-supprimer-une-categorie-dans-menu-manager), [Deliveroo — remise au livreur dans son parcours commerces alimentaires](https://help.deliveroo.com/en/articles/6840244-how-to-use-the-deliveroo-order-picker-retail-grocery-partners-only).

La présentation du menu par catégories est également observable sur [Just Eat — exemple de carte partenaire](https://www.just-eat.co.uk/restaurants-german-doner-kebab-kingston-kingston-upon-thames/menu).
