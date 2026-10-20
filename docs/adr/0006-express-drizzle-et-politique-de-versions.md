# ADR 0006 — Express 5, Drizzle et politique de versions

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

L'API a peu de routes, mais un webhook dont la signature se vérifie sur le **corps brut**, et un
worker qui partage son code. L'écosystème doit être connu de la plupart des développeurs Node.js.

## Décision

- **Express 5** : erreurs des handlers `async` propagées nativement, `express.raw()` pour garder le
  corps brut du webhook, Helmet et express-rate-limit éprouvés. Validation par **Zod 4**.
- **Drizzle ORM** : requêtes typées proches du SQL, migrations SQL générées et relues.
- **Octokit** (`@octokit/rest`, `@octokit/auth-app`) : authentification GitHub App (JWT RS256 puis
  jeton d'installation mis en cache), pagination, en-têtes de version d'API.
- **Next.js 16** (App Router) pour le tableau de bord : rendu serveur, l'API relayée sur la même
  origine, le cookie de session n'est jamais lisible par JavaScript.
- **ESM natif** et TypeScript `nodenext` côté serveur.

| Dépendance | Version | Raison                                                         |
| ---------- | ------- | -------------------------------------------------------------- |
| Node.js    | 22 LTS  | LTS jusqu'en avril 2027                                        |
| TypeScript | 5.9     | typescript-eslint ne supporte pas encore TypeScript 7          |
| Express    | 5       | Version courante                                               |
| BullMQ     | 5       | API stable et éprouvée ; la v6 sera évaluée dans une PR dédiée |
| ioredis    | 5       | Client attendu par BullMQ 5                                    |
| PostgreSQL | 17      | Supporté par RDS et Neon                                       |
| MongoDB    | 8       | Version courante de MongoDB Atlas                              |
| Next.js    | 16      | Avec React 19                                                  |

Dependabot propose les mises à jour mineures et correctives chaque semaine ; les versions majeures
font l'objet d'une pull request dédiée.

## Conséquences

- ⚠️ ESM impose des extensions `.js` dans les imports TypeScript.
- ⚠️ Express ne valide pas les réponses : les routes du tableau de bord passent par des fonctions
  de projection explicites (pas de fuite de colonne interne).
