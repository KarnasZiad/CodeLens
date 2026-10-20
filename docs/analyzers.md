# Catalogue des règles

Chaque constat a une **sévérité** : `info`, `minor`, `major`, `critical`, `blocker`. Par défaut, la
quality gate échoue dès qu'il y a un constat `blocker` ou `critical` ; les autres sont signalés
sans bloquer.

Sauf mention contraire, une règle ne regarde que les **lignes ajoutées ou modifiées** de la PR.

| Analyseur          | Règle                   | Sévérité     | Langages            | Pourquoi                                                                  |
| ------------------ | ----------------------- | ------------ | ------------------- | ------------------------------------------------------------------------- |
| `secrets`          | `aws-access-key`        | blocker      | tous                | Une clé AWS commitée est exploitée en quelques minutes par des robots     |
| `secrets`          | `github-token`          | blocker      | tous                | Jetons `ghp_`, `gho_`, `ghs_`, `github_pat_`…                             |
| `secrets`          | `slack-token`           | blocker      | tous                | Jetons `xoxb-`, `xoxp-`…                                                  |
| `secrets`          | `stripe-key`            | blocker      | tous                | Clés `sk_live_` et `rk_live_`                                             |
| `secrets`          | `google-api-key`        | blocker      | tous                | Clés `AIza…`                                                              |
| `secrets`          | `private-key`           | blocker      | tous                | En-tête PEM d'une clé privée                                              |
| `secrets`          | `hardcoded-credential`  | blocker      | tous, hors tests    | `password = "…"` dont la valeur ressemble à un vrai secret                |
| `sql-injection`    | `string-built-query`    | critical     | JS, TS, Vue, Python | Interpolation ou concaténation dans `query`, `execute`, `raw`…            |
| `debug-statements` | `focused-test`          | critical     | JS, TS, Vue         | `it.only` désactive silencieusement les autres tests en CI                |
| `debug-statements` | `debugger`              | major        | JS, TS, Vue         | Met l'application en pause quand les outils de développement sont ouverts |
| `debug-statements` | `breakpoint`            | major        | Python              | `breakpoint()` bloque le processus en attente d'une saisie                |
| `debug-statements` | `console`               | minor        | JS, TS, Vue         | Sortie de débogage hors tests et hors `allowConsoleIn`                    |
| `complexity`       | `cyclomatic-complexity` | major        | JS, TS              | Fonction modifiée au-delà du seuil (10 par défaut)                        |
| `dependencies`     | `lockfile-not-updated`  | major        | npm                 | `package.json` modifié sans lockfile : versions non reproductibles        |
| `dependencies`     | `new-dependency`        | info         | npm                 | Chaque dépendance ajoutée mérite un regard (maintenance, licence)         |
| `pr-size`          | `pull-request-size`     | minor, major | PR                  | Au-delà de 400 lignes, la qualité de la revue chute                       |
| `missing-tests`    | `no-test-change`        | minor        | PR                  | Du code ajouté sans aucun test modifié                                    |
| `todo-comments`    | `todo-without-ticket`   | info         | code                | Un TODO sans ticket est rarement traité                                   |
| `codelens`         | `config-changed`        | info         | PR                  | La nouvelle configuration ne s'applique qu'après la fusion                |

## Détails

### Secrets

- Le constat donne le **type** de secret et sa **ligne**, jamais sa valeur, même partielle.
- Les formats de fournisseurs sont signalés partout, y compris dans les fichiers de test : un vrai
  jeton dans une fixture reste un jeton divulgué.
- Les affectations (`password`, `secret`, `apiKey`, `client_secret`…) ne sont signalées que si la
  valeur fait au moins 8 caractères, n'a rien d'un exemple (`changeme`, `<…>`, `${…}`,
  `process.env`…) et a une entropie d'au moins 3 bits par caractère.
- Retirer le secret dans un commit suivant ne suffit pas : il faut le **révoquer**.

### Injection SQL

Heuristique : une interpolation `${…}` dans une template **passée en argument** d'un appel de
requête, ou une chaîne SQL concaténée avec `+`. Les templates taguées (`` sql`…` ``,
`` prisma.$queryRaw`…` ``) sont paramétrées par leur tag et ne sont pas signalées. En Python : les
f-strings, `%` et `.format()` passés à `execute`.

Sans analyse de flux, la règle ne distingue pas une constante d'une valeur venue de l'utilisateur.
La construction est risquée dans tous les cas ; le correctif (paramètres liés) est toujours simple.

### Complexité cyclomatique

Calculée sur l'arbre syntaxique TypeScript : `if`, `?:`, boucles, `case`, `catch`, `&&`, `||`, `??`
et leurs affectations (`&&=`, `||=`, `??=`) comptent chacun pour un. Les fonctions imbriquées sont
mesurées séparément. Seules les fonctions qui contiennent une ligne modifiée sont signalées. Le code
n'est ni compilé ni exécuté.

## Configuration

`.codelens.yml`, à la racine du dépôt, **lu sur la branche de base** de la PR :

```yaml
ignore:
  - '**/*.generated.ts'
  - 'vendor/**'
analyzers:
  complexity:
    threshold: 15
  debug-statements:
    allowConsoleIn: ['scripts/**', 'apps/cli/**']
  pr-size:
    warnAt: 300
    failAt: 800
  todo-comments:
    enabled: false
gate:
  maxFindings:
    blocker: 0 # valeur par défaut
    critical: 0 # valeur par défaut
    major: 5 # null = illimité (valeur par défaut)
```

Une clé inconnue, une valeur hors bornes ou un YAML invalide donnent un check `neutral` qui liste
chaque erreur avec sa ligne : une faute de frappe ne désactive jamais silencieusement une règle.
