## Objectif

<!-- Problème résolu, user story ou issue (ex. US-07, #42). -->

## Changements

-

## Comment tester

<!-- Étapes reproductibles pour le relecteur. -->

## Checklist de l'auteur

- [ ] Titre en Conventional Commits (`feat(analyzers): ...`)
- [ ] Tests ajoutés ou mis à jour ; `pnpm test` et `pnpm lint` passent en local
- [ ] Documentation et ADR mis à jour si une décision change

## Checklist sécurité

- [ ] Toute entrée externe (webhook, API GitHub, `.codelens.yml`, requête du tableau de bord) est validée par un schéma Zod
- [ ] Aucune donnée d'un dépôt n'est visible par un utilisateur sans accès à son installation (IDOR)
- [ ] Les secrets détectés ne sont jamais recopiés en clair dans un commentaire, un log ou la base
- [ ] Le code analysé n'est jamais exécuté ; les expressions régulières sont bornées (pas de ReDoS)
- [ ] Aucun secret ni jeton dans les logs, les erreurs ou les fixtures

## Checklist performance

- [ ] Le webhook répond sans attendre l'analyse (travail déporté dans la file BullMQ)
- [ ] Les appels à l'API GitHub sont paginés, bornés et respectent les limites de débit
- [ ] Les nouvelles requêtes PostgreSQL et MongoDB sont couvertes par un index
