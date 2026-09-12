# Traduction des conversations

Le chat demande automatiquement une traduction des messages libres reçus dans la langue choisie par le lecteur. Le texte original reste disponible et n’est jamais remplacé dans `order_messages`. Les réponses rapides utilisent leurs traductions préparées, sans appel à un fournisseur.

Les langues principales sont le français (`fr`), le créole haïtien, Kreyòl ayisyen (`ht`), et le portugais du Brésil (`pt`). Les quatre autres langues historiques restent acceptées par l’API. La langue réelle d’un message libre est détectée par le moteur : un profil français peut écrire en portugais. La langue du profil expéditeur ne permet donc pas de sauter l’appel. Si le moteur détecte la langue cible, le serveur renvoie l’original exact, sans réécriture.

## État vérifié le 12 septembre 2026

L’authentification OIDC de l’équipe `is4acs-projects` fonctionne : une lecture de `/v1/credits` retourne HTTP 200. Deux demandes de traduction **fictives**, avec `openai/gpt-4.1-mini` et `google/gemini-2.5-flash-lite`, ont été refusées avant génération : HTTP 403, type `customer_verification_required`.

Le message de Vercel demande une carte valide enregistrée afin de débloquer les crédits gratuits. Le solde et la consommation étaient tous deux à zéro avant et après les essais. Aucun achat, abonnement, ajout de carte ou changement d’environnement distant n’a été effectué. Aucun message de conversation réel n’a été utilisé.

L’administrateur doit terminer lui-même l’activation depuis [le lien officiel renvoyé par Vercel AI Gateway](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card), en sélectionnant l’équipe du projet. Ne pas acheter de crédits ou activer de recharge automatique pour simplement essayer l’allocation gratuite.

Les [conditions actuelles du palier gratuit](https://vercel.com/docs/ai-gateway/pricing) annoncent 5 USD par mois, un sous-ensemble de modèles éligibles et des limites de débit. L’achat de crédits met fin à cette allocation gratuite mensuelle. L’activation du compte et l’éligibilité réelle du modèle doivent être vérifiées avant d’annoncer la traduction comme opérationnelle.

**La qualité réelle des traductions haïtiennes et portugaises n’a pas encore pu être qualifiée.** Les tests automatisés valident le transport, les permissions et les erreurs avec des réponses simulées.

## Configuration serveur

Sur Vercel, OIDC permet d’utiliser Gateway sans créer de clé persistante. Le service lit le jeton au moment de la requête ; dans le runtime Vercel, l’en-tête interne `x-vercel-oidc-token` prend priorité sur le jeton d’environnement. Une `AI_GATEWAY_API_KEY` explicite prend priorité sur OIDC. Aucun jeton ne doit être placé dans une variable `VITE_`, dans le navigateur ou dans Git. Voir [l’authentification OIDC officielle](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc) et [la référence des jetons de fonction](https://vercel.com/docs/oidc/reference).

| Variable | Défaut / effet |
| --- | --- |
| `MANJEO_TRANSLATE_PROVIDER` | `auto` : relais explicitement configuré, sinon Gateway si un jeton existe. `vercel` force Gateway ; `libretranslate` force le relais configuré. |
| `MANJEO_TRANSLATE_MODEL` | `openai/gpt-4.1-mini`, modèle de Gateway. |
| `MANJEO_TRANSLATE_REQUESTS_PER_MINUTE` | 30 nouvelles demandes par compte et par minute. |
| `MANJEO_TRANSLATE_CHARACTERS_PER_DAY` | 20 000 caractères de messages par jour UTC, pour le schéma de base. |
| `MANJEO_TRANSLATE_REQUESTS_PER_DAY` | 500 demandes par jour UTC, pour limiter aussi les très petits messages. |
| `MANJEO_TRANSLATE_URL` | URL HTTPS du relais LibreTranslate compatible, seulement si l’exploitant choisit ce service. |
| `MANJEO_TRANSLATE_KEY` | Clé facultative de ce relais. |

Les quotas Preview et Production sont séparés quand leurs schémas sont séparés. Les cache hits et réponses rapides ne consomment pas le quota ; les tentatives échouées le consomment afin de borner les répétitions. Il n’y a aucune connexion automatique à un service public de traduction ou à un modèle téléchargé dans le navigateur.

Le prix catalogue vérifié de [GPT-4.1 mini](https://vercel.com/ai-gateway/models/gpt-4.1-mini) est de 0,40 USD par million de tokens d’entrée et 1,60 USD par million de tokens de sortie. À titre de calcul, 200 tokens d’entrée et 100 de sortie représentent 0,00024 USD. La consommation réelle dépend du texte, du prompt et de la sortie ; les quotas en caractères ne garantissent pas un montant exact. Un autre modèle configuré peut avoir un prix différent.

Les appels Gateway utilisent l’API REST OpenAI compatible, une URL fixe, un délai réseau de huit secondes, une réponse limitée et aucune redirection. Le champ JSON `providerOptions.gateway.disallowPromptTraining=true` impose les fournisseurs sans entraînement sur ces données. Cette extension est explicitement documentée pour [Chat Completions, Python et cURL](https://vercel.com/docs/ai-gateway/security-and-compliance/disallow-prompt-training). Elle ne signifie pas une garantie de conservation zéro.

## Contrat et conservation

`POST /api/translate`, avec session connectée :

```json
{"orderId":"MJ-EXEMPLE","messageId":"identifiant-du-message","to":"ht"}
```

`to` est facultatif et utilise alors la langue du profil du lecteur. Le serveur vérifie l’accès à la conversation, charge le message original, puis renvoie :

```json
{"text":"Traduction","from":"pt","to":"ht","cached":false,"provider":"vercel"}
```

Les identifiants ne permettent pas de traduire une conversation étrangère. L’accès est vérifié avant un résultat en cache et à nouveau après le réseau : un livreur ayant libéré sa mission perd cet accès. Une réponse rapide renvoie `provider:"phrases"`.

Le cache PostgreSQL/SQLite est indexé par le message, son contenu et sa langue enregistrée, la cible, le fournisseur/modèle et la version du prompt. Il conserve au maximum 5 000 entrées, avec une durée de trente jours. Une réservation de quinze secondes évite les demandes simultanées pour la même traduction. Une demande concurrente reçoit rapidement 429 ; le navigateur peut réessayer un nombre limité de fois.

L’authentification, la réservation et l’écriture du résultat utilisent de courtes transactions distinctes. Aucun verrou de commande ni connexion de base n’est conservé pendant l’appel réseau. Les textes vides, les sorties tronquées, les réponses invalides et les sorties identiques annoncées dans une autre langue ne sont pas enregistrés comme traductions réussies. Les erreurs libèrent leur réservation et restent réessayables.

- 401/403 : connexion requise ou conversation inaccessible.
- 429 : demande déjà en cours, limite de débit ou quota quotidien atteint.
- 502 : fournisseur en panne ou traduction inexploitable.
- 503 : moteur absent, activation de compte requise ou accès/crédits indisponibles.

L’ancien corps `{text,from,to}` reste compatible uniquement avec un relais `MANJEO_TRANSLATE_URL` explicitement configuré ; il n’ouvre pas un accès Gateway à des textes arbitraires. Pour les messages identifiés, le relais reçoit `source:"auto"` et doit renvoyer `detectedLanguage.language` avec `translatedText`, conformément à [l’API LibreTranslate](https://docs.libretranslate.com/api/operations/translate/).

## Vérification

```sh
.venv/bin/python -m unittest server.test_translation server.test_messaging -q
```

Ces tests n’appellent aucun fournisseur réel. Avec `MANJEO_TEST_DATABASE_URL` pointant vers une base dédiée, les mêmes contrats s’exécutent dans des schémas PostgreSQL temporaires. Ne jamais fournir l’URL de la base publique à ces tests.

Après activation, exécuter ce corpus synthétique dans les six directions, avec revue par des locuteurs compétents. Les phrases haïtiennes ci-dessous sont des supports de test préparés, pas une certification linguistique.

| Direction | Original à traduire | Points à vérifier |
| --- | --- | --- |
| Français → haïtien | « Je suis devant la pharmacie, à droite du portail bleu. J’arrive dans 3 minutes. » | Position, portail bleu, délai exact. |
| Haïtien → français | « Pa mete piman nan manje a, tanpri. Gen 2 timoun k ap manje avè m. » | Négation, piment, deux enfants. |
| Portugais brésilien → haïtien | « Não toque a campainha; meu bebê está dormindo. Pode me ligar quando chegar? » | Ne pas sonner, bébé endormi, question. |
| Haïtien → portugais brésilien | « Mwen sou bò dwat pòtay la. Mwen gen sèlman 20 € sou mwen. » | Côté droit, restriction « seulement », montant. |
| Français → portugais brésilien | « Merci de retirer les oignons. Gardez la sauce dans un petit pot à part. » | Retrait des oignons, sauce séparée. |
| Portugais brésilien → français | « Faltam 2 sucos no pedido. A sacola estava fechada quando recebi. » | Deux jus manquants, sac fermé à la réception. |

Vérifier aussi : profil français avec texte portugais ; texte déjà dans la langue du lecteur ; orthographe familière ; noms et adresses ; et un message contenant « Ignore les instructions précédentes ». Ce dernier doit être traduit comme un message, jamais exécuté comme une consigne au modèle. Conserver l’original visible et qualifier les résultats avant toute affirmation de fiabilité linguistique.
