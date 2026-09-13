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
  du suivi de commande. Aucun filet d’1 px.
- Rayons : blocs 18–20 px · vignettes 12–14 px · photo de la fiche restaurant 24 px ·
  feuille mobile 28 px · boutons, champs, pastilles **999 px** ; l’étiquette d’offre est le seul
  rayon asymétrique du produit (`0 999px 999px 0`), parce qu’elle sort du bord de la photo.
- États définis une seule fois (`.primary-btn`, `.punch-btn`, `.outline-btn`) : survol, pressé,
  `:focus-visible` en `3px solid var(--ink)` (cream sur fond encre), désactivé à 45 %.
  Le contour encre remplace le jaune sur crème : leurs contrastes sont respectivement
  15,55:1 et 1,37:1. Dans le menu de langue, le fond jaune du choix pointé garde un
  contour intérieur encre de 2 px pour rester repérable au clavier.
- Transitions fonctionnelles seulement, 150 ms `ease-out`. Aucun parallax, aucun `hover:scale`.
- `prefers-reduced-motion: reduce` coupe animations et défilements animés.
- Aucun bandeau défilant : le bandeau de promesses de la maquette a été retiré de l’accueil, l’en-tête encre porte seul la marque, la bascule de service, l’adresse, la recherche, le panier et la langue.

## L’accueil mené par les offres

L’accueil suit `ACCUEIL.md` du handoff : plus de héros, la page répond d’emblée à
« qu’est-ce qui est intéressant, près de moi, maintenant ». Les blocs, dans cet ordre :

1. **En-tête encre** — marque, bascule Livraison / À emporter, pilule d’adresse, champ de
   recherche, compte, commandes, panier, langue.
2. **Rangée d’envies** — une pastille ronde de 62 px par catégorie réellement présente au
   catalogue, glyphe Lucide à `stroke-width: 2.5`, jamais d’emoji. « Tout » est l’état actif par
   défaut ; il n’y a pas de pastille « Voir tout » puisque toutes les envies tiennent déjà sur la
   rangée.
3. **Quatre filtres** — Offres · Moins de 25 min · Livraison au tarif le plus bas du catalogue ·
   Mieux notés (★ 4,8 et plus). Cumulables avec l’envie ; une combinaison vide affiche « Aucun
   restaurant ne correspond » et un bouton « Effacer les filtres », jamais une page blanche. À
   droite, le nombre d’adresses ouvertes et l’heure de Cayenne, rafraîchie chaque minute.
4. **« Les bons plans du moment »** — les codes valables partout, puis le tarif de livraison le
   plus bas du catalogue. Trois traitements dans cet ordre : aplat jaune, crème cadré d’encre,
   aplat encre à titre jaune.
5. **« En promotion maintenant »** — une carte par adresse qui porte une offre : photo non lavée,
   **étiquette d’offre en drapeau** sortant du bord gauche à 14 px du haut (la même place sur
   toutes les cartes du site), pied séparé d’un filet 2 px encre, prix d’appel et prix barré.
6. **« Tous les restaurants »** — les lignes de liste, avec le tri complet : c’est ici qu’il vit,
   pas dans les quatre filtres.
7. **Bandeau de réassurance** encre, trois colonnes, et sur mobile une **barre d’onglets** basse
   (Accueil · Offres · Panier · Compte, cibles ≥ 44 px) — le seul endroit du produit où le texte
   descend sous 13 px.

Les rayons 4 et 5 défilent horizontalement : une carte par pas, flèches désactivées en butée,
aucun défilement automatique, et les cartes gardent 248 px minimum plutôt que de s’écraser. Un
rayon s’ouvre toujours sur sa première carte.

### Les offres ne sont jamais décoratives

Le handoff prévoyait un champ `promos` dans `lib/catalog.json`. Il n’a pas été ajouté : une
étiquette qui ne change pas ce que le client paie serait un mensonge d’affichage. Les offres de
l’accueil sont donc **les codes promotionnels réels** de `server/promotions.py`, lus par
`GET /api/promotions` — libellé, barème, minimum et échéance viennent du serveur, celui-là même
qui accorde la remise au paiement.

- une seule offre par adresse : seuls les codes réservés à un restaurant font une étiquette ;
  les codes valables partout alimentent les bons plans (`lib/offers.ts`) ;
- le **prix barré** n’apparaît que si la remise s’applique vraiment à une commande d’un seul
  plat — bon barème et minimum atteint. Une livraison offerte ne barre jamais un prix de plat ;
- sur une ligne de liste, la pastille résume le barème (`−15 %`, `−3,00 €`, « Livraison offerte »)
  parce que le nom du restaurant est déjà écrit juste à côté ; sur une carte, l’étiquette porte le
  libellé complet du serveur ;
- « Prendre le code » et « Commander » posent le code dans le panier ; c’est le serveur qui
  l’accepte ou le refuse, et un code refusé n’est jamais réessayé en silence.

`server/test_business.py` vérifie que la remise que l’accueil annoncerait sur une commande d’un
seul plat est exactement celle que `/api/promotions/check` accorde — ou aucune, s’il la refuse.

## Écrans

| Écran | Fichiers |
| --- | --- |
| Accueil, liste, fiche restaurant, panier, commande, suivi | `app/page.tsx`, `app/globals.css` |
| Lecture des offres de l’accueil | `lib/offers.ts`, `server/promotions.py` |
| Options de produit, suivi, annulation | `app/customer-flow.css` |
| Connexion et comptes de démonstration | `app/application.tsx`, `app/accounts.css` |
| Espaces restaurateur, livreur, administration | `app/staff.css`, `app/courier.css`, `app/menu-editor.css` |

Les rayons et les lignes de liste lisent le catalogue (`lib/catalog.json` via `lib/api.ts`) :
délais, frais de livraison, quartier et prix d’appel ne sont jamais écrits en dur. Le prix d’appel
d’une ligne est le plat le moins cher de la carte principale du restaurant, pas la boisson la moins
chère (`startingPrice`, `lib/menu.ts`). Les prix restent en centimes et sont formatés par `money()`.
Le champ `area` du catalogue porte le quartier affiché sous le nom ; `seed()` (`server/app.py`)
ajoute aux fiches déjà en base les champs de catalogue qui leur manquent, sans jamais réécrire ce
qu’un restaurateur a modifié.

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

## Écarts assumés par rapport au handoff

- « Livraison offerte dès 25 € » est remplacé par le prix de livraison le plus bas du catalogue : la
  démo facture toujours la livraison, une promesse d’offre serait démentie au paiement.
- Le bouton d’action du paiement porte le montant mais dit « Confirmer », pas « Payer » : aucun
  paiement réel n’a lieu dans cette démonstration.
- Le second bouton rond de la fiche restaurant ouvre le panier (`shopping-bag`) plutôt qu’un `plus`
  sans fonction dans l’application.
- Le stepper descendu à zéro retire la ligne du panier, comme le demande le handoff ; le bouton
  corbeille a donc disparu.
- La bascule **« À emporter »** est présente mais n’est pas branchée : la démonstration ne sait
  faire que de la livraison, et un mode de retrait qui facturerait quand même la livraison et
  enverrait un livreur serait faux. Le bouton le dit au lieu de le simuler.
- La troisième colonne du bandeau de réassurance dit « Paiement de démonstration » et non
  « Payé à la livraison » : aucun encaissement réel n’a lieu.
- Le champ `promos` du handoff n’existe pas : voir « Les offres ne sont jamais décoratives ».
