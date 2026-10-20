# Contribuer à CodeLens

## Flux de travail

1. Créer une branche depuis `main` : `feat/<sujet>`, `fix/<sujet>`, `docs/<sujet>`, `chore/<sujet>`.
2. Commiter en [Conventional Commits](https://www.conventionalcommits.org/fr/), vérifié par commitlint.
3. Ouvrir une pull request en remplissant le template (checklists sécurité et performance).
4. La CI doit être verte : format, lint, typecheck, tests unitaires et couverture, build, tests
   d'intégration Testcontainers, image Docker scannée, CodeQL, Trivy et revue des dépendances.
5. Fusion en _squash merge_. `main` est protégée : pas de push direct, pull request et checks CI
   obligatoires. Le dépôt a un seul mainteneur, donc aucune approbation n'est exigée ; en équipe,
   la règle passe à une approbation d'un code owner (`CODEOWNERS`).

## Prérequis

- Node.js 22 (`.nvmrc`), pnpm 10 via Corepack (`corepack enable`)
- Docker pour PostgreSQL, MongoDB et Redis en local et pour les tests d'intégration

## Commandes

| Commande                | Rôle                                                     |
| ----------------------- | -------------------------------------------------------- |
| `pnpm dev`              | API, worker et tableau de bord en mode watch             |
| `pnpm lint`             | ESLint avec règles typées, zéro avertissement toléré     |
| `pnpm typecheck`        | TypeScript strict sur tous les packages                  |
| `pnpm test:coverage`    | Tests unitaires et HTTP avec seuils de couverture (80 %) |
| `pnpm test:integration` | PostgreSQL, MongoDB et Redis réels avec Testcontainers   |
| `pnpm format`           | Prettier                                                 |

## Ajouter un analyseur

1. Créer `packages/review-engine/src/analyzers/<nom>.ts` qui implémente `Analyzer`.
2. L'enregistrer dans `analyzers/index.ts` et ajouter ses options au schéma de `.codelens.yml`.
3. Le tester sur des diffs réels : un cas qui déclenche, un cas proche qui ne déclenche pas.
4. Documenter la règle, sa sévérité et sa justification dans `docs/analyzers.md`.

Un analyseur ne fait aucune entrée/sortie : il reçoit le diff et le contenu des fichiers, et rend
des constats. Il ne doit jamais exécuter le code analysé.

## Revue de code

Le relecteur vérifie en priorité : validation des entrées externes, cloisonnement par installation,
absence de secret recopié, expressions régulières bornées, et pertinence des constats (un faux
positif coûte la confiance des développeurs).
