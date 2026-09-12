# Audit des parcours du 12 septembre 2026

Session demandée de 17 h 55 à 19 h 55 UTC (14 h 55 à 16 h 55 en Guyane), sur la branche `codex/two-hour-business-audit`. Point de départ : `f4d0e4a`. Les essais d’écriture utilisent des bases SQLite temporaires, un PostgreSQL local dédié ou le schéma Preview `manjeo_audit_20260912`.

## Changements vérifiés

### Confirmation, compte et panier

Une réponse perdue après création pouvait entraîner une nouvelle commande après rechargement. Une **Confirmation à reprendre** conserve maintenant le corps exact, le destinataire, les instructions et l’UUID, séparément pour chaque compte. La reprise est explicite ; une nouvelle confirmation reste bloquée tant que le résultat demeure incertain. Un panier constitué entre-temps n’est pas effacé lorsque la première commande est retrouvée.

Les actions et lectures privées annoncent le compte affiché avec `X-Manjeo-Account`. Le serveur vérifie ce contexte contre le cookie avant la recherche d’idempotence et les mutations. Si un autre onglet a changé de compte, l’action est refusée et la session est relue. Le corps de commande conserve son empreinte initiale. Une réponse ancienne ou un changement A → B → A ne remplace plus l’état du nouveau parcours.

Les formulaires de compte et de restaurant adoptent les champs frais qui n’ont pas été modifiés. Une sauvegarde n’envoie que les changements du formulaire. Les modifications du téléphone, de l’adresse ou de la présentation ne réenregistrent plus des valeurs anciennes dans d’autres champs. La sauvegarde facultative du profil n’empêche pas de retrouver une commande confirmée ni d’ouvrir son paiement.

Les essais navigateur vérifient les prix changés pendant la confirmation, la suppression d’une option, la mise en pause d’un produit, le changement de restaurant et le retrait d’une promotion devenue inapplicable. La confirmation exige le consentement au nouveau montant ; une commande déjà confirmée garde son instantané.

### Restaurant, livreur et administration

Les mutations réussies restent affichées même si une lecture secondaire échoue. Les rafraîchissements concurrents ne remplacent pas une modification de carte, de présentation ou d’ouverture. Les affectations proposées sont revérifiées lorsque le livreur sélectionné devient indisponible.

Les versions de carte et les conflits restent contrôlés côté serveur. Les produits archivés sont comptés dans la limite de carte ; un ancien catalogue dépassant déjà cette limite reste modifiable sans croissance. Les importations d’image abandonnées avec l’écran ne se poursuivent pas sous le compte suivant.

Le parcours par les vrais boutons vérifie : accepter, préparer, marquer prête, prendre la course, retirer le sac, refuser un mauvais code de remise puis livrer avec le bon. Les offres libres ne révèlent ni destination exacte ni téléphone ; le code reste réservé au client et à l’administration.

Les commandes Stripe qui ne sont jamais entrées en cuisine restent aussi inaccessibles au restaurant par l’URL du fil, les non-lus et les traductions. Le contrôle précède les récépissés de lecture et l’appel à un moteur. Une commande payée puis acceptée et annulée conserve sa conversation autorisée.

Les entrées JSON contenant un caractère NUL, un surrogate Unicode isolé, un nombre non fini ou une profondeur excessive reçoivent une erreur 400. Cela évite des réponses 500 et des différences entre SQLite et PostgreSQL. Les accents, écritures multilingues, emoji et séquences Unicode valides sont conservés sans normalisation ; les empreintes et reprises restent identiques.

### Délais, adresses et conversations

L’expiration reste persistée même si l’action demandée est refusée. L’acceptation tardive ne réactive pas une commande ; son code promo est rendu. Une réponse tardive de Stripe ne fournit pas un lien Checkout périmé. Le délai d’acceptation après paiement commence après acquisition du verrou d’écriture du webhook.

L’interface retire les preuves d’adresse expirées pendant que le formulaire reste ouvert et permet de vérifier à nouveau. Le serveur recontrôle la session après le fournisseur d’adresse.

La fermeture d’écriture du chat dépend de l’événement de fin de commande. Une mise à jour de paiement ou un remboursement ultérieur ne rouvre pas la fenêtre. Le client retrouve le fil d’une commande acceptée puis annulée ; une annulation avant acceptation n’ouvre pas de fil. Un livreur qui libère sa course perd les messages et coordonnées à l’actualisation suivante.

Les réponses rapides sont adaptées localement à la langue choisie après chargement de leur répertoire. Les textes libres restent visibles dans leur forme originale si le fournisseur de traduction est indisponible. Le bouton d’affichage de l’original est vérifié avec un lecteur en créole haïtien.

### Interface et maintenance

La bande de langues séparée est retirée. Le sélecteur FR / HT / PT est intégré à l’en-tête principal, immédiatement à droite du panier côté client et à droite des actions des espaces professionnels. Les noms complets restent dans le menu déroulant et son libellé accessible. Le choix persiste, y compris après rechargement ; le menu reste disponible pendant le chargement ou une erreur d’espace.

Le module professionnel est chargé à l’ouverture de l’espace concerné. Un échec de téléchargement offre une reprise et un retour au catalogue. Les dialogues d’aide, d’informations et d’installation restent dans la hauteur disponible à 320 × 568 pixels, avec défilement et navigation clavier.

Le pied de page distingue une recherche de promotions en cours, une liste vide et une panne avec possibilité de réessayer. Les blocs du compte et de commande réutilisent les couleurs et bordures de la direction Punch.

Les noms et catégories longs reviennent à la ligne sans cacher les actions. Les limites du formulaire de commande sont cohérentes avec celles du compte et du serveur : nom de 100 caractères, précisions de 300 caractères. Les valeurs initiales d’un nouveau produit ou choix d’option utilisent la langue de création ; changer de langue ne réécrit pas les données saisies.

L’audit npm du verrou initial signalait quatre dépendances d’outillage. Vite passe de 8.0.13 à 8.0.16 ; PostCSS, nanoid et esbuild sont actualisés dans leurs versions compatibles. Après installation, `npm audit` ne signale aucune vulnérabilité connue et `pip check` ne signale aucune dépendance Python cassée. Ce résultat n’est pas une certification de sécurité. Références : [correctif Vite pour les chemins Windows](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff), [correctif PostCSS](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp).

### Clavier, libellés et lectures de collections

Échap ferme la liste de suggestions d’adresse avant le dialogue. Les flèches permettent de la rouvrir sans modifier le texte. Le nom accessible du champ reste stable quand une proposition est active. Les dialogues contrôlés rendent le focus à leur déclencheur, y compris panier → adresse et produit → remplacement, sans reprendre le focus à une nouvelle fenêtre.

Les groupes de filtres, de tri, de carte et de comptes portent un rôle accessible compatible avec leur nom. Le contour du focus passe en encre sur fond crème (contraste de 15,55:1), avec le contour crème conservé sur fond sombre. Le choix pointé dans le menu de langue garde un contour intérieur encre.

Les lectures de collections utilisent un préchargement des produits et une jointure pour les livreurs. Les tests comparent exactement les données et leur tri, y compris noms identiques, profils absents, prix modifiés, produits archivés et courses terminées. Les empreintes des tables restent identiques avant et après lecture.

| Collection isolée | Avant | Après |
| --- | --- | --- |
| Catalogue de six restaurants | 7 requêtes SQL | 2 requêtes SQL |
| Liste admin de cinquante livreurs | 108 requêtes SQL | 8 requêtes SQL |

Ces comptes de requêtes sont identiques sur SQLite et PostgreSQL. Les mesures de durée effectuées sur le PostgreSQL local ne sont pas une estimation de la latence Neon en Production.

Un jeu de 1 000 commandes historiques, cinq actives et 3 003 messages vérifie aussi la stabilité des lectures et des redémarrages. Le nombre de requêtes ne croît pas avec l’historique ; les listes complètes restent toutefois proportionnelles au nombre de commandes en volume JSON. Aucune pagination n’est ajoutée dans cette session.

Le contrôle de reprise réseau conserve le panier, propose une actualisation et récupère le module professionnel après un échec simulé. Les réponses privées Vercel (`session`, `profile`, `orders`) et le catalogue portent `Cache-Control: no-store`. Il n’y a ni service worker ni démarrage hors ligne ; le manifeste permet seulement l’installation d’un raccourci d’application.

## Essais en conditions Vercel

Le premier lot, `c06bf78`, passe le parcours avec véritable géocodage IGN sur la [Preview isolée](https://manjeo-pv64n8ko3-is4acs-projects.vercel.app). Les comptes et données de cette Preview sont distincts du schéma public.

Trois échéances ont été observées en temps réel :

| Vérification | Résultat UTC |
| --- | --- |
| Acceptation après dix minutes, annulation enregistrée et promotion restituée | 18:41:09, conforme |
| Preuve d’adresse refusée après quinze minutes | 18:46:07, conforme |
| Conversation encore lisible, nouvel envoi refusé après trente minutes | 19:01:11, conforme |

Le lot consolidé `88b5ec1` passe ensuite le parcours IGN et quatre rôles sur la [seconde Preview](https://manjeo-p4fky8drj-is4acs-projects.vercel.app). Le changement de cookie client → admin y est également testé : refus de la confirmation et du profil avec `session_changed`, aucune commande créée sous l’autre compte, resynchronisation de l’espace et conservation de la tentative d’origine.

Ce commit a été publié sur `main`. La Production `dpl_GC1GfNP3Ea68tHMaP5UcBt3An69h` est associée à [manjeo.vercel.app](https://manjeo.vercel.app). La session existante fonctionne après le déploiement ; les empreintes des profils, cartes et instantanés des six commandes initiales sont inchangées (quatre comptes, six restaurants). Le contrôle public confirme la persistance FR/HT/PT, le menu déroulant vers le bas, l’affichage mobile et la disponibilité du paiement de démonstration, sans exception JavaScript.

## Résultats automatisés

| Ensemble | Résultat |
| --- | --- |
| Python 3.12, SQLite et PostgreSQL 16 dédié | 319 tests passés, aucun ignoré |
| Tests client | 165 passés, aucun ignoré |
| Parcours navigateur depuis une installation vierge | 42 passés sur Chromium, WebKit et Firefox, aucun ignoré |
| TypeScript et Vite 8.0.16 | Compilation réussie |
| Installation `codex-setup.sh` depuis un checkout vierge | Réussie avec Node 22 et Python 3.12 |
| `codex-check.sh` sans connexion de test PostgreSQL | 170 tests Python exécutés et 145 ignorés comme prévu ; 165 tests client et compilation réussis |

Un essai à graine fixe (`20260912`) exécute aussi 200 actions sur SQLite et les mêmes 200 sur PostgreSQL : créations, replays, acceptations, annulations, affectations, libérations, préparation, retrait et remise. Les résultats sont identiques. Chaque base reçoit 2 200 requêtes HTTP de contrôle, sans erreur 500. Après chaque étape sont revérifiés les montants, instantanés, historique, capacité livreur, projections privées et accès aux fils. Les 403/409 attendus ne sont pas considérés comme des échecs de l’application.

Les 45 vues mobiles examinées couvrent compte, adresse, paiement, panier et formulaire dans les trois langues à 320, 390 et 430 pixels. Les régressions vérifient la position des boutons et textes dans leur conteneur, en plus de la largeur du document. Un passage axe sur neuf écrans ne relève aucune violation automatique. Les libellés de groupes signalés ont été corrigés. Les cinq contrôles automatiques encore incomplets concernent les zones défilantes et le confinement du focus : les boutons sont examinés après défilement (contraste de texte 15,55:1), et 150 déplacements Tab / Maj-Tab restent dans les dialogues compte et produit. Cela ne constitue pas un essai complet avec lecteur d’écran.

## Limites

Les commandes, livraisons et paiements restent fictifs. Stripe n’est utilisable qu’en mode test, après configuration serveur. Aucun encaissement réel ni achat n’est activé.

AI Gateway reste bloqué par `customer_verification_required`. Les tests simulent le moteur ou vérifient la conservation de l’original ; ils ne qualifient pas une traduction automatique réelle ni sa qualité linguistique. Les formulations FR/HT/PT doivent être relues par des locuteurs compétents avant exploitation réelle.

Les parcours automatisés couvrent Chromium, WebKit et Firefox. Ils n’équivalent pas à des essais sur chaque appareil physique ni à une certification d’accessibilité. Les vérifications d’adresse portent sur un point IGN choisi ; Google Maps, Waze et Plans sont des liens de navigation.

Vercel Hobby n’exécute pas de tâche de fond d’expiration dans ce projet. Une échéance est appliquée à la prochaine requête métier concernée.
