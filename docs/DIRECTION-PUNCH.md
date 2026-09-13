# Direction visuelle « Punch »

Refonte de l’interface à partir du handoff *Manjéo Refonte* (direction 2a retenue par le client).
Fond crème, un seul jaune en aplat, encre noire pour tout le texte, titres en grotesque noir tout en
capitales. Les explorations 1a/1b/1c du canvas ne sont pas implémentées.

## Les cinq interdits

1. aucun dégradé ;
2. aucun emoji en guise d’icône — icônes Lucide, `stroke-width: 2.75` (`.lucide` dans
   `app/globals.css`) ; « ★ » est un caractère typographique, pas une icône ;
3. pas de grille de cartes arrondies génériques — des **lignes** de liste cadrées d’un trait de 2 px ;
4. un seul accent, le jaune : il ne porte jamais de texte fin, il est toujours le fond et l’encre
   toujours le texte ;
5. pas de typo passe-partout : **Archivo Black** en capitales pour le display, **Figtree** pour
   l’interface.

## Jetons

Tous les jetons sont déclarés une seule fois dans `:root` au début de `app/globals.css`. **Ne jamais
écrire un hex dans un composant** : passer par `var(--…)`.

| Jeton | Valeur | Usage |
| --- | --- | --- |
| `--cream` | `#FFF0DD` | fond de page, lignes de liste |
| `--cream-2` | `#FFF8EC` | fond des sections et des blocs |
| `--ink` | `#1B1A17` | tout le texte, la nav, les boutons primaires, les bordures 2 px |
| `--ink-hover` / `--ink-press` | `#2A2823` / `#000000` | états du bouton encre |
| `--ink-soft` | `#4A4740` | texte secondaire |
| `--ink-mute` | `#6B6559` | labels et mentions |
| `--ink-on-dark` | `#C9C2B2` | texte secondaire sur fond encre |
| `--punch` | `#FFC93C` | l’accent : aplats, pastilles, bouton panier, bloc livraison |
| `--punch-hover` / `--punch-press` | `#F5BC22` / `#E0A80F` | états du bouton jaune |
| `--line` / `--line-2` | `#E2D8C2` / `#D9D0BC` | bordures des blocs et des filtres inactifs |
| `--shadow-md` / `--shadow-lg` | `0 3px 10px` / `0 12px 32px` | conteneurs ; ailleurs la profondeur vient des bordures |

Les variables shadcn (`--background`, `--primary`, `--border`…) pointent vers ces jetons, donc les
primitives `components/ui/*` héritent de la direction sans feuille de style parallèle.

## Typographie

- Display : `var(--display)` — Archivo Black 400, toujours en capitales, jamais en paragraphe ni
  sous 11 px. Repli `"Arial Black", system-ui, sans-serif`.
- Interface : `var(--body)` — Figtree 400/600/700.
- Échelle : h1 76 px/0.94 · h2 38 px · titre d’écran 30 px · nom de restaurant 23 px · nom de plat
  15–17 px · corps 14–18 px/1.5 · méta 13 px · labels 11–12 px en capitales. En mobile les titres
  descendent à 44 px (h1) et 28 px (h2), jamais en dessous.
- Les deux familles sont chargées depuis Google Fonts dans `index.html` (`display=swap`).

## Géométrie et états

- Bordures : **2 px partout** (la signature de la direction) ; 3 px seulement pour la pastille ronde
  du héros. Aucun filet d’1 px.
- Rayons : blocs 18–20 px · vignettes 12–14 px · photo du héros 24 px · feuille mobile 28 px ·
  boutons, champs, pastilles **999 px**.
- États définis une seule fois (`.primary-btn`, `.punch-btn`, `.outline-btn`) : survol, pressé,
  `:focus-visible` en `3px solid var(--ink)` (cream sur fond encre), désactivé à 45 %.
  Le contour encre remplace le jaune sur crème : leurs contrastes sont respectivement
  15,55:1 et 1,37:1. Dans le menu de langue, le fond jaune du choix pointé garde un
  contour intérieur encre de 2 px pour rester repérable au clavier.
- Transitions fonctionnelles seulement, 150 ms `ease-out`. Aucun parallax, aucun `hover:scale`.
- `prefers-reduced-motion: reduce` coupe animations et défilements animés.
- Aucun bandeau défilant : le bandeau de promesses de la maquette a été retiré de l’accueil, l’en-tête encre porte seul la marque, l’adresse, le panier et la langue.

## Écrans

| Écran | Fichiers |
| --- | --- |
| Accueil, liste, fiche restaurant, panier, commande, suivi | `app/page.tsx`, `app/globals.css` |
| Options de produit, suivi, annulation | `app/customer-flow.css` |
| Connexion et comptes de démonstration | `app/application.tsx`, `app/accounts.css` |
| Espaces restaurateur, livreur, administration | `app/staff.css`, `app/courier.css`, `app/menu-editor.css` |

Le héros et les lignes de liste lisent le catalogue (`lib/catalog.json` via
`lib/api.ts`) : délais, frais de livraison, plat du jour et prix d’appel ne sont jamais écrits en dur. Le prix
d’appel d’une ligne est le plat le moins cher de la carte principale du restaurant, pas la boisson la
moins chère. Les prix restent en centimes et sont formatés par `money()` (`lib/menu.ts`).

## Icône d’application et favicons

Candidate retenue : **3a « Le M plein »** — la marque réduite à sa lettre, M en Archivo Black encre sur
aplat jaune, avec un disque `#F5BC22` décalé en bas à gauche qui donne la profondeur sans ombre ni
dégradé. Les fichiers sont dans `public/icons/`, le manifeste en `public/site.webmanifest`, et le
`<head>` d’`index.html` les déclare (`favicon.svg`, `icon-32.png`, `apple-touch-icon`, manifeste,
`theme-color` encre). `icons/icon.svg` est la source de vérité : en cas de divergence avec les PNG,
c’est lui qui fait foi. L’inventaire des fichiers est dans [ASSET-SOURCES.md](../ASSET-SOURCES.md).

Règles d’usage :

- jamais de dégradé, de relief, d’ombre portée ni de photo dans l’icône ;
- le jaune est toujours le fond, l’encre toujours le glyphe — ne pas inverser ;
- le M occupe ~56 % de la hauteur : ne pas le rapprocher des bords, la découpe iOS/Android mangerait
  ses empattements ;
- le disque `#F5BC22` est décoratif : il peut disparaître aux petites tailles (c’est déjà le cas dans
  `favicon.svg`) mais ne doit jamais changer de couleur ;
- sur fond sombre l’icône tient seule — pas de contour, pas de halo ;
- pas de variante saisonnière, pas de badge « nouveau » incrusté.

Le serveur local déclare `application/manifest+json` pour `.webmanifest` (`server/app.py`) : sans ce
type, `X-Content-Type-Options: nosniff` ferait rejeter le manifeste par le navigateur.

## Découpe de l’accueil

`app/home/` porte l’accueil client : `home-screen.tsx` compose la page et ne tient que ses propres
réglages (catégorie, quatre filtres, tri, index des carrousels) ; `header.tsx`, `hero.tsx`,
`order-banner.tsx`, `categories.tsx`, `filters.tsx`, `promo-rail.tsx` + `deal-card.tsx`,
`promo-cards.tsx`, `tables.tsx` + `restaurant-row.tsx`, `offer-flag.tsx`, `reassurance.tsx` et
`mobile-tabs.tsx` sont présentationnels, chacun avec sa feuille de style à côté. `promos.ts` regroupe
les règles pures (offre active d’une table, prix d’appel remisé) et `rail.tsx` les commandes de
carrousel partagées.

`app/page.tsx` garde tout l’état de commande : panier, paiement, promotions vérifiées, reprise d’une
confirmation incertaine. Les invariants du contrat ne traversent jamais `app/home/`.

## Écarts assumés par rapport au handoff

- « Livraison offerte dès 25 € » est remplacé par le prix de livraison le plus bas du catalogue : la
  démo facture toujours la livraison, une promesse d’offre serait démentie au paiement.
- Le bouton d’action du paiement porte le montant mais dit « Confirmer », pas « Payer » : aucun
  paiement réel n’a lieu dans cette démonstration.
- Le second bouton rond de la fiche restaurant ouvre le panier (`shopping-bag`) plutôt qu’un `plus`
  sans fonction dans l’application.
- Le stepper descendu à zéro retire la ligne du panier, comme le demande le handoff ; le bouton
  corbeille a donc disparu.

### Accueil mené par les offres (handoff « Manjeo Accueil Client », ancres 4a / 5a / 5b / 5c)

- La maquette dessine neuf pastilles de catégorie, dont « Desserts ». Aucune table du catalogue n’est
  une table de desserts : la rangée se construit sur les catégories réellement présentes, sinon le
  filtre mènerait toujours au vide. Huit pastilles plus « Voir tout ».
- « Healthy » devient « Bowls » au catalogue, le nom employé par la maquette et par la table
  elle-même (« Bowls · Fraîcheur »).
- Le rayon « Les bons plans du moment » est alimenté par `/api/promotions`, les codes réellement
  ouverts, comme le demande le premier chantier. Le champ `promos` du catalogue alimente les
  étiquettes d’offre et les prix barrés ; son drapeau `highlight` ordonne le rayon « En promotion ce
  soir » au lieu de remonter dans les bons plans, les deux sources étant distinctes.
- Les codes de démonstration gardent une fenêtre large (2026 → 2030) plutôt que la semaine de la
  maquette : une promotion expirée disparaîtrait de la page et la démonstration doit rester
  utilisable dans le temps. La règle d’expiration, elle, est bien appliquée.
- **Le code `LIVRAISON` (« Livraison offerte dès 25 € ») remonte sur l’accueil avec sa condition.**
  Il ne s’agit pas d’une promesse décorative : le serveur couvre réellement la livraison au-delà de
  25 € (`discount_for`, `kind = delivery`). Aucune autre mention de livraison offerte n’est posée sur
  la page. Pour que l’accueil ne parle jamais de gratuité, il faut désactiver ce code de démonstration
  dans `server/promotions.py`, pas filtrer l’affichage.
- La pilule d’adresse et le bouton panier restent dans l’en-tête au premier passage, que la maquette
  `5a` retire : l’adresse doit rester atteignable une fois le héros défilé, et le panier se remplit
  avant l’adresse dans cette application. Le champ de recherche, lui, n’apparaît qu’au visiteur
  connu, comme la maquette.
- « Créer un compte » n’est pas posé : la démonstration n’ouvre pas d’inscription, seulement des
  comptes de démonstration.
- Le bandeau de commande porte l’identifiant réel (`MJ-…`) et non le numéro à quatre chiffres de la
  maquette. « Appeler Jordan » devient « Écrire à {livreur} » : le téléphone du livreur n’est exposé
  que par la fiche de contact de la conversation, selon le contrat des quatre rôles.
- La troisième colonne du bandeau de réassurance annonce le paiement de démonstration, pas un
  « payé à la livraison » que la démonstration ne propose pas.
- La bascule Livraison / À emporter change l’affichage de la liste (horaires de retrait au lieu des
  frais) et l’annonce en toutes lettres : la démonstration termine toujours la commande en livraison.
- Flèches de carrousel et pastilles de langue portées à 44 px de cible tactile, au-dessus des 40 px
  dessinés, conformément à la règle d’accessibilité du même handoff.
