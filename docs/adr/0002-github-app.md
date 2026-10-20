# ADR 0002 — Une GitHub App plutôt qu'une OAuth App ou une action GitHub

- **Statut** : acceptée
- **Date** : 2026-10-20

## Contexte

CodeLens doit lire le diff d'une PR, publier des annotations sur des lignes précises et un verdict
qui peut bloquer la fusion. Trois intégrations sont possibles.

## Décision

CodeLens est une **GitHub App**.

| Critère                       | GitHub App                      | OAuth App                      | Action GitHub               |
| ----------------------------- | ------------------------------- | ------------------------------ | --------------------------- |
| API Checks (annotations)      | ✅ réservée aux GitHub Apps     | ❌                             | ✅ via `GITHUB_TOKEN`       |
| Permissions                   | fines, par dépôt choisi         | celles de l'utilisateur        | celles du workflow          |
| Jetons                        | d'installation, expirent en 1 h | de l'utilisateur, longue durée | du workflow                 |
| Identité des commentaires     | `codelens[bot]`                 | un compte humain               | `github-actions[bot]`       |
| Historique et tableau de bord | ✅ service central              | ✅                             | ❌ chaque dépôt isolé       |
| Coût pour l'équipe            | aucun minute CI                 | aucun                          | minutes de CI à chaque push |

Permissions demandées (manifeste dans `github-app-manifest.json`) :

- `checks: write` — check run et annotations ;
- `pull_requests: write` — commentaire de synthèse ;
- `contents: read` — fichiers de la PR et `.codelens.yml` ;
- `metadata: read` — imposée par GitHub.

Événements : `pull_request`, `installation`, `installation_repositories`.

## Conséquences

- ✅ Une fuite de jeton d'installation est limitée à une heure et aux dépôts de l'installation.
- ✅ Le tableau de bord utilise la connexion OAuth de la même application (jetons utilisateur).
- ⚠️ La clé privée de l'application est le secret le plus sensible du système : elle est montée
  comme secret, jamais journalisée, et sa rotation est documentée dans le README.
- ⚠️ Le développement local nécessite un relais de webhooks (smee.io).
