# ADR 0004 — PostgreSQL pour les données requêtées, MongoDB pour les documents bruts

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

Deux familles de données coexistent :

- des données **relationnelles et agrégées** : installations, dépôts, PR, analyses, constats, que le
  tableau de bord filtre, pagine et agrège par semaine ;
- des **documents** dont la forme varie et qui sont lus en entier : payloads de webhooks (utiles
  pour rejouer un incident) et rapports complets (configuration effective, durée par analyseur,
  constats bruts avant bornage).

## Décision

- **PostgreSQL 17** avec **Drizzle ORM** : schéma typé en TypeScript, migrations SQL lisibles
  générées par drizzle-kit, contraintes d'unicité qui portent l'idempotence.
- **MongoDB 8** : collections `webhook_deliveries` et `review_reports`, chacune avec un index TTL.
  L'insertion avec `_id = X-GitHub-Delivery` sert de dédoublonnage atomique.

## Alternatives écartées

- **Tout dans PostgreSQL (`jsonb`)** : possible, mais les payloads volumineux et expirants gonflent
  la base relationnelle et ses sauvegardes ; le TTL natif de MongoDB évite une tâche de purge.
- **Tout dans MongoDB** : les tendances (constats par analyseur et par semaine, jointures
  PR ↔ analyses ↔ constats) sont plus simples et plus sûres en SQL, avec des clés étrangères.

## Conséquences

- ✅ La rétention est garantie par la base (TTL), sans tâche planifiée.
- ✅ La désinstallation efface en cascade toutes les données relationnelles du compte.
- ⚠️ Deux bases à exploiter et à sauvegarder ; les documents MongoDB expirent d'eux-mêmes.
