# ADR 0001 — Enregistrer les décisions d'architecture

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Un outil de revue de code doit lui-même être facile à relire : pourquoi une analyse est asynchrone,
pourquoi la configuration vient de la branche de base, pourquoi une panne ne bloque pas la fusion.

## Décision

Chaque décision structurante est consignée dans un ADR au format de Michael Nygard (contexte,
décision, conséquences, alternatives), versionné avec le code et relu dans la pull request qui
l'introduit. Un ADR accepté n'est jamais réécrit : un nouvel ADR le remplace.

## Conséquences

- Un nouveau contributeur retrouve la justification des choix sans fouiller l'historique.
- Le modèle de menaces référence les ADR, et inversement.
