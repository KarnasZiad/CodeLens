# ADR 0003 — Accuser le webhook, analyser dans une file BullMQ

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

GitHub abandonne une livraison au bout de 10 secondes et la marque en échec. Une analyse dure de une
à trente secondes selon la PR et dépend de la disponibilité et des quotas de l'API GitHub. Un push
déclenche parfois plusieurs livraisons pour le même commit.

## Décision

- L'API vérifie la signature, enregistre la livraison, crée l'analyse et l'enfile dans **BullMQ**
  (Redis), puis répond `202` : le chemin du webhook ne fait aucun appel à GitHub.
- Le **worker** est un processus distinct (même image, autre commande) avec une concurrence bornée.
- Idempotence à trois niveaux : identifiant de livraison, unicité `(PR, SHA)` de l'analyse,
  `jobId` BullMQ égal à l'identifiant de l'analyse.
- Reprises : 3 tentatives avec attente exponentielle pour les erreurs transitoires ; la limite de
  débit GitHub met la file en pause (`RateLimitError`) sans consommer de tentative.

## Alternatives écartées

- **Traiter dans la requête** : timeouts GitHub dès qu'une PR est grosse, aucune reprise.
- **Fonction serverless par événement** : démarrages à froid, pas de limitation globale du débit
  vers GitHub, et une infrastructure de plus à exploiter.
- **RabbitMQ** : très bien pour du routage entre services, mais Redis est déjà nécessaire (sessions,
  limitation de débit) et BullMQ apporte reprises, priorités et limiteur prêts à l'emploi.

## Conséquences

- ✅ Le webhook répond en quelques millisecondes ; un pic de pushes s'absorbe dans la file.
- ✅ Un worker arrêté pendant une analyse la reprend au redémarrage (verrou de job expiré).
- ⚠️ Redis devient critique : persistance AOF activée, et une indisponibilité fait répondre le
  webhook en `503`, que GitHub permet de rejouer.
