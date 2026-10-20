# Pipeline de revue

## De l'événement au check

```mermaid
sequenceDiagram
  participant GH as GitHub
  participant API as API
  participant M as MongoDB
  participant PG as PostgreSQL
  participant Q as BullMQ (Redis)
  participant W as Worker

  GH->>API: POST /webhooks/github (pull_request.synchronize)
  API->>API: HMAC-SHA256 du corps brut, comparaison en temps constant
  API->>M: insère la livraison (_id = X-GitHub-Delivery)
  alt livraison déjà traitée
    API-->>GH: 200 duplicate
  else nouvelle livraison
    API->>PG: upsert dépôt et PR, crée l'analyse (PR, SHA) si absente
    API->>Q: add("review", { runId }, { jobId: runId })
    API-->>GH: 202 Accepted
  end
  Q->>W: job
  W->>GH: POST /check-runs (in_progress)
  W->>GH: GET fichiers de la PR (paginé, borné)
  W->>GH: GET .codelens.yml sur la branche de base
  W->>GH: GET contenu des fichiers utiles aux analyseurs
  W->>W: moteur : analyseurs, déduplication, quality gate
  W->>PG: constats et verdict (transaction)
  W->>M: rapport complet
  W->>GH: PATCH /check-runs (conclusion, annotations par lots de 50)
  W->>GH: crée ou met à jour le commentaire de synthèse
```

## Idempotence

| Niveau      | Clé                                   | Effet d'un doublon                     |
| ----------- | ------------------------------------- | -------------------------------------- |
| Livraison   | `X-GitHub-Delivery` (`_id` MongoDB)   | `200 duplicate`, rien n'est enfilé     |
| Analyse     | unicité `(pull_request_id, head_sha)` | la même analyse est réutilisée         |
| Job         | `jobId = runId`                       | BullMQ ignore un job déjà présent      |
| Commentaire | marqueur `<!-- codelens:summary -->`  | le commentaire existant est mis à jour |

GitHub peut rejouer une livraison (bouton « Redeliver » ou reprise après un timeout) : elle porte le
même identifiant. Une livraison dont l'enfilage a échoué n'est pas marquée traitée : le rejeu la
reprend.

## Erreurs et reprises

- Erreur réseau ou `5xx` de GitHub : nouvelle tentative avec attente exponentielle (3 essais).
- Limite de débit atteinte (`403` ou `429` avec `x-ratelimit-remaining: 0`) : la file est mise en
  pause jusqu'à `x-ratelimit-reset`, sans consommer de tentative.
- Échec définitif : l'analyse passe `failed` et le check se termine en **`neutral`** avec un message
  d'excuse. Une panne de CodeLens ne bloque jamais une fusion ([ADR 0005](../adr/0005-moteur-d-analyse-pur-et-extensible.md)).
- Configuration invalide : check `neutral` qui liste les erreurs de `.codelens.yml`.

## Bornes

| Borne                               | Valeur | Au-delà                                          |
| ----------------------------------- | ------ | ------------------------------------------------ |
| Taille d'un webhook                 | 1 Mo   | `413`                                            |
| Fichiers analysés par PR            | 300    | rapport marqué partiel                           |
| Fichiers dont le contenu est chargé | 50     | analyse de complexité limitée aux premiers       |
| Taille d'un fichier chargé          | 200 Ko | fichier ignoré par les analyseurs de contenu     |
| Longueur d'une ligne analysée       | 1 000  | ligne ignorée (code minifié, données)            |
| Annotations publiées                | 200    | les plus graves d'abord, le reste dans le résumé |
