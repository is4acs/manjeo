# Paiements Stripe — première intégration de test

Le code prépare un paiement sur la page hébergée de Stripe. **Aucun encaissement réel n’est activé.**
Le mode de démonstration conserve sa commande simulée explicite. L’option Stripe reste indisponible
tant que sa configuration serveur de test n’est pas complète. Aucun compte Stripe, moyen de paiement,
abonnement ou configuration payante n’a été créé par cette intégration.

Les essais automatisés remplacent Stripe par un fournisseur fictif et signent leurs propres événements
avec une clé fictive. Ils vérifient le protocole et les droits ; ils ne prouvent pas qu’un compte Stripe
ou Apple Pay/Google Pay fonctionne effectivement sur le déploiement.

## Parcours et moyens de paiement

1. Le serveur valide le compte client, la carte, les options, les prix, les coordonnées et la promotion.
   Il calcule le montant entier en centimes, puis conserve l’instantané de la commande.
2. Une commande simulée passe en `pending` comme auparavant. Une commande Stripe passe en
   `awaiting_payment` : aucune préparation, affectation, livraison ou conversation n’est ouverte.
3. Le client propriétaire demande la page Checkout. Le serveur envoie uniquement l’identifiant de
   commande, ses identifiants techniques de rapprochement et le total validé. Stripe reçoit une ligne
   globale comprenant les articles, la livraison et la remise. Les coordonnées de livraison et les
   notes personnelles ne sont pas envoyées dans les métadonnées Stripe.
4. Le navigateur ouvre une URL HTTPS `checkout.stripe.com`. Manjéo ne crée aucun champ de numéro
   de carte, date d’expiration ou CVC et ne collecte pas ces valeurs dans son API.
5. Le retour du navigateur affiche le suivi de la commande. **Ce retour ne confirme jamais le paiement.**
   Seul le webhook signé attestant `payment_status=paid` et `status=complete` ouvre `pending`.
   Les dix minutes laissées au restaurateur démarrent alors, et non au début du paiement.

Cette intégration demande le type `card` à Checkout. Apple Pay et Google Pay peuvent apparaître dans
la page Stripe selon les paramètres du compte, la compatibilité du navigateur/appareil et la présence
d’un portefeuille utilisable. Manjéo n’affiche pas de boutons de portefeuille factices et ne garantit
pas leur présence. Les pages hébergées Stripe prennent en charge ces portefeuilles sans formulaire
spécifique dans Manjéo. [Documentation des moyens de paiement Checkout](https://docs.stripe.com/payments/checkout/save-during-payment#payment-methods).

Checkout reçoit `fr` pour l’interface française et créole haïtienne, `pt-BR` pour le portugais du Brésil.
Le créole haïtien ne figure pas parmi les langues Checkout proposées ; le repli français est donc
explicite. La langue et les montants de la page Manjéo sont conservés.
[Paramètres de création d’une session](https://docs.stripe.com/api/checkout/sessions/create).

## Configuration serveur, uniquement dans un environnement de test isolé

| Variable | Valeur attendue |
| --- | --- |
| `MANJEO_PAYMENT_MODE` | `demo` par défaut ; `stripe_test` pour rendre l’option Stripe disponible après configuration |
| `STRIPE_SECRET_KEY` | Clé secrète **de test** commençant par `sk_test_` |
| `STRIPE_WEBHOOK_SECRET` | Secret `whsec_` du webhook de ce même environnement de test |
| `APP_ORIGIN` | Origine HTTPS exacte de ce déploiement ; HTTP accepté seulement pour localhost/127.0.0.1/::1 |
| `MANJEO_DB_SCHEMA` | Schéma de test isolé correspondant au déploiement ; ne pas réutiliser les données du site public pour les essais |

Ne jamais ajouter ces secrets à Git, à un message, à une capture, au journal de l’application ou à une
variable `VITE_`. Aucune clé publique Stripe n’est nécessaire pour rediriger vers Checkout hébergé.
Une clé `sk_live_`, une configuration incomplète ou une origine incorrecte désactive l’option et fait
refuser toute création Stripe avec une erreur explicite. Le JSON public de configuration ne contient
aucune clé ni identifiant de compte.

Le client REST contacte seulement `https://api.stripe.com/v1`, sans suivre les redirections, avec un
délai de huit secondes et une réponse bornée. Il utilise explicitement la version API stable
`2025-06-30.basil`, à conserver également pour les événements « snapshot » configurés dans Stripe.
Une mise à jour de version doit faire l’objet d’essais séparés.
[Historique officiel Basil](https://docs.stripe.com/changelog/basil).

Créer manuellement un endpoint Stripe **de test** :

```text
https://votre-deploiement-test.example/api/payments/stripe/webhook
```

Événements à sélectionner :

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `refund.created`
- `refund.updated`
- `refund.failed`

Stripe doit pouvoir joindre cet endpoint en HTTPS. La protection SSO d’une Preview Vercel peut bloquer
ses appels ; vérifier l’accessibilité de ce seul endpoint de test avec l’administrateur avant de tenter
un paiement. Ne pas désactiver globalement les protections ni exposer une base de production pour
contourner le problème. En développement local, la CLI Stripe peut relayer les événements ; son secret
de signature diffère de celui du webhook créé dans le Dashboard.
[Configuration et essais des webhooks](https://docs.stripe.com/webhooks).

## Contrat API et branchement Python

| Appel | Droits et effet |
| --- | --- |
| `GET /api/payments/config` | Public : `{mode, stripeAvailable, reason}` ; aucun secret |
| `POST /api/orders` | Client ; `paymentMethod: "demo"` ou `"stripe"`, défaut `demo` pour les anciens clients |
| `POST /api/orders/:id/checkout` | Client propriétaire uniquement ; corps `{language: "fr"\|"ht"\|"pt"}` facultatif ; réponse `{checkoutUrl, orderId}` |
| `POST /api/orders/:id/refund` | Admin uniquement, commande annulée payée, corps `{}` ; demande le remboursement intégral de test |
| `POST /api/payments/stripe/webhook` | Aucun cookie ; corps brut et signature Stripe obligatoires |

`order.payment` contient `provider: "demo"|"stripe"`, `testMode: true`, `status` et, pour une attente
Stripe, `expiresAt`. Il ne contient ni secret de session Checkout ni identifiant PaymentIntent.
Le lien Checkout est fourni seulement au client propriétaire par l’endpoint dédié.

États de paiement :

- `simulated` : démonstration explicite, sans opération Stripe ;
- `awaiting_payment` : commande bloquée avant paiement ;
- `paid` : paiement de test confirmé par webhook signé ;
- `cancelled` / `expired` : commande non payée abandonnée ou expirée ;
- `refund_pending` : remboursement nécessaire ou demandé, encore non confirmé ;
- `refunded` : remboursement intégral confirmé par webhook signé ;
- `refund_failed` : échec Stripe confirmé, à traiter par l’administrateur.

Points d’intégration de `server/payments.py` :

```python
initialize_payments(db)                 # migration idempotente dans la transaction existante
method = validate_requested_payment(data)
prepare_order_payment(order, method)    # après validations métier et avant INSERT orders
register_payment(db, order)             # après INSERT orders, dans la même transaction
cancel_payment(db, order)               # sur toute annulation, AVANT save_order/UPDATE final
expire_awaiting_payments(db, stamp=None) # sweep lifecycle sous verrou d’écriture existant
```

`handle_payment_request(handler, path, data=None, raw_body=None)` doit être appelé **avant** que le
répartiteur général ouvre une connexion ou un verrou de base ; il gère lui-même ses transactions
courtes. Il renvoie `(status, payload, cookie)` ou `None` pour une route qui ne le concerne pas.

Pour le seul chemin POST `/api/payments/stripe/webhook`, lire au maximum `MAX_WEBHOOK_BYTES`
(256 Kio) sans parser ni réencoder le JSON, puis transmettre ces octets au module. Ce seul endpoint
exempte le cookie et le contrôle d’origine navigateur ; toutes les autres écritures les conservent.
La signature HMAC-SHA256 couvre exactement `timestamp.corps_brut`, compare les signatures en temps
constant et refuse un horodatage passé ou futur de plus de cinq minutes. Le mode réel est refusé.
Le corps est ensuite parsé et l’événement rapproché du paiement, de la commande, du client, de la
session, de la devise et du montant. [Signature et corps brut](https://docs.stripe.com/webhooks/signature).

## Idempotence, courses concurrentes et expirations

Les tables `order_payments` et `payment_events` sont ajoutées sans reconstruire les commandes
historiques. Les métadonnées utilisent un identifiant aléatoire de paiement enregistré, distinct de
l’identifiant de commande : un webhook destiné à un autre schéma isolé ne modifie rien ici.

Une commande garde une seule session Checkout. La première tentative enregistre ses paramètres
avant l’appel réseau ; les tentatives suivantes conservent ces paramètres et la même clé
d’idempotence, même si la langue demandée change ou si une réponse réseau a été perdue.
Deux créations concurrentes ne créent donc pas deux opérations distinctes chez Stripe. Les
identifiants d’événement webhook sont également uniques en base, sous verrou d’écriture.

L’attente de paiement dure une heure depuis la création de commande. Une première session ne peut
plus être créée après trente minutes d’attente : Stripe impose au moins trente minutes avant son
expiration. Une session déjà créée conserve son échéance initiale. Le retour `payment=cancel`
signifie seulement que le client est revenu de Checkout ; il peut reprendre ou annuler sa commande.
L’annulation explicite ne rouvre jamais la cuisine, même si une confirmation de paiement arrive ensuite.
[Expiration des sessions](https://docs.stripe.com/api/checkout/sessions/expire).

L’expiration enregistrée lors des requêtes de cycle de vie annule la commande et libère sa promotion.
Il n’y a pas de tâche planifiée implicite. Si un paiement arrive après une annulation ou après
l’échéance locale, la commande reste annulée et passe en `refund_pending`.
Un événement d’expiration reçu après un paiement confirmé n’efface pas ce paiement.

## Annulations et remboursements de test

Toute annulation après paiement, y compris l’expiration du délai du restaurateur, doit appeler le hook
`cancel_payment` dans sa transaction. Le statut `refund_pending` reste durable et visible tant que
le remboursement n’est pas confirmé.

Dans cette première étape, l’administrateur demande le remboursement via l’endpoint prévu. Il ne
s’agit pas d’un remboursement automatique en arrière-plan. La demande est intégrale, utilise le
PaymentIntent enregistré et une clé d’idempotence stable. Une réponse réseau perdue peut être
réessayée sans créer volontairement une deuxième demande. Même une réponse Stripe synchrone
`succeeded` reste « en attente » dans Manjéo jusqu’au webhook signé.

Un remboursement déjà enregistré en échec nécessite une vérification dans Stripe ; le code ne
crée pas aveuglément une deuxième opération. Les remboursements partiels, reversements vers les
restaurants/livreurs, commissions et Stripe Connect ne font pas partie de cette première étape.
[API de remboursement](https://docs.stripe.com/api/refunds/create).

## Vérifications avant activation effective

```sh
.venv/bin/python -m unittest server.test_payments -v
```

Les cas PostgreSQL nécessitent `MANJEO_TEST_DATABASE_URL` vers une base dédiée et créent uniquement
leurs propres schémas `manjeo_test_<uuid>`. Sans cette variable, ils sont explicitement ignorés.
Ces tests ne doivent jamais lire une connexion Neon de production ni utiliser de vraies clés Stripe.

Avec un compte sandbox/test et un webhook accessible, vérifier ensuite manuellement : paiement carte
de test réussi et refusé, authentification demandée, retour avant webhook, double clic, expiration,
annulation puis paiement tardif, remboursement et reprise après panne réseau. Apple Pay et Google Pay
nécessitent des essais supplémentaires sur les appareils compatibles et dans les conditions publiées
par Stripe. **Ne pas annoncer ces moyens comme opérationnels avant ces essais.**
[Répertoire officiel des scénarios de test](https://docs.stripe.com/testing).
